import { randomUUID } from "node:crypto";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { z } from "zod";
import { digest, roomKey, rooms, type RoomService } from "./rooms";
import { ServiceError } from "./store";

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const PAYMENT_NETWORK = "eip155:8453";
const day = 86_400_000;

const authorizationSchema = z.object({
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  value: z.literal("1000000"),
  validAfter: z.string().regex(/^\d{1,12}$/),
  validBefore: z.string().regex(/^\d{1,12}$/),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
type Authorization = z.infer<typeof authorizationSchema>;

export interface PaymentConfig {
  payTo: Address;
  facilitatorUrl: string;
  rpcUrl: string;
  origin: string;
}

export function paymentConfig(): PaymentConfig {
  if (
    !process.env.X402_PAY_TO_ADDRESS ||
    /^0x0{40}$/i.test(process.env.X402_PAY_TO_ADDRESS)
  )
    throw new ServiceError(
      503,
      "PAYMENTS_UNAVAILABLE",
      "Payment recipient is not configured.",
    );
  return {
    payTo: getAddress(process.env.X402_PAY_TO_ADDRESS),
    facilitatorUrl:
      process.env.X402_FACILITATOR_URL || "https://facilitator.payai.network",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    origin: process.env.SITE_URL || "https://openchatnet.com",
  };
}

export interface SettlementGateway {
  blockNumber(): Promise<string>;
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<boolean>;
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;
  recover(
    authorization: Authorization,
    fromBlock: string,
    transaction?: string,
  ): Promise<SettleResponse | null>;
}

const tokenEvents = parseAbi([
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export function settlementGateway(config: PaymentConfig): SettlementGateway {
  const facilitator = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    timeoutMs: 15_000,
  });
  const client = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 0 }),
  });
  return {
    async blockNumber() {
      return String(await client.getBlockNumber());
    },
    async verify(payload, requirements) {
      return (await facilitator.verify(payload, requirements)).isValid;
    },
    settle: (payload, requirements) =>
      facilitator.settle(payload, requirements),
    async recover(authorization, fromBlock, transaction) {
      const latest = await client.getBlockNumber();
      const hashes = transaction
        ? [transaction as Hex]
        : (
            await client.getLogs({
              address: USDC_BASE,
              event: tokenEvents[0],
              args: {
                authorizer: authorization.from as Address,
                nonce: authorization.nonce as Hex,
              },
              fromBlock: BigInt(fromBlock),
              toBlock:
                latest < BigInt(fromBlock) + BigInt(1000)
                  ? latest
                  : BigInt(fromBlock) + BigInt(1000),
            })
          ).map((log) => log.transactionHash);
      for (const hash of hashes) {
        const receipt = await client.getTransactionReceipt({ hash });
        if (
          receipt.status !== "success" ||
          latest < receipt.blockNumber + BigInt(1)
        )
          continue;
        let used = false;
        let transferred = false;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== USDC_BASE.toLowerCase()) continue;
          try {
            const event = decodeEventLog({
              abi: tokenEvents,
              data: log.data,
              topics: log.topics,
            });
            if (event.eventName === "AuthorizationUsed")
              used ||=
                event.args.authorizer.toLowerCase() ===
                  authorization.from.toLowerCase() &&
                event.args.nonce.toLowerCase() ===
                  authorization.nonce.toLowerCase();
            if (event.eventName === "Transfer")
              transferred ||=
                event.args.from.toLowerCase() ===
                  authorization.from.toLowerCase() &&
                event.args.to.toLowerCase() === config.payTo.toLowerCase() &&
                event.args.value === BigInt(1_000_000);
          } catch {
            continue;
          }
        }
        if (used && transferred)
          return {
            success: true,
            transaction: hash,
            network: PAYMENT_NETWORK,
            payer: authorization.from,
            amount: "1000000",
          };
      }
      return null;
    },
  };
}

interface ReceiptRecord {
  room_id: string;
  fingerprint: string;
  from_block: string;
  paid_until?: number;
  settlement?: SettleResponse;
  transaction?: string;
}

export const paymentScript = `
local operation = ARGV[1]
local record = redis.call('GET', KEYS[1])
if operation == 'get' then return record or '' end
if operation == 'claim' then
  if not record then
    if redis.call('EXISTS', KEYS[2]) == 0 then return '' end
    redis.call('SET', KEYS[1], ARGV[2], 'EX', 7776000)
    return ARGV[2]
  end
  return record
end
if not record then return '' end
record = cjson.decode(record)
if record.fingerprint ~= ARGV[2] then return '' end
if operation == 'transaction' then
  record.transaction = ARGV[3]
  redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
  return cjson.encode(record)
end
if operation == 'grant' then
  if record.paid_until then return cjson.encode(record) end
  if redis.call('EXISTS', KEYS[2]) == 0 then return '' end
  local now = tonumber(ARGV[3])
  local paidUntil = math.max(now, tonumber(redis.call('HGET', KEYS[2], 'paid_until') or 0)) + 86400000
  redis.call('HSET', KEYS[2], 'paid_until', paidUntil)
  redis.call('EXPIRE', KEYS[2], math.ceil((paidUntil - now) / 1000) + 604800)
  record.paid_until = paidUntil
  record.settlement = cjson.decode(ARGV[4])
  redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
  return cjson.encode(record)
end
return ''
`;

export class PaymentService {
  constructor(
    public service: RoomService,
    public config: PaymentConfig,
    public gateway: SettlementGateway,
  ) {}

  requirements(): PaymentRequirements {
    return {
      scheme: "exact",
      network: PAYMENT_NETWORK,
      asset: USDC_BASE,
      amount: "1000000",
      payTo: this.config.payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
    };
  }

  async challenge(roomId: string): Promise<PaymentRequired> {
    await this.service.info(roomId);
    return {
      x402Version: 2,
      resource: {
        url: `${this.config.origin}/api/rooms/${roomId}/upgrade`,
        description:
          "24 hours of unlimited participant slots; traffic and storage limits still apply.",
        mimeType: "application/json",
      },
      accepts: [this.requirements()],
    };
  }

  async upgrade(roomId: string, signature: string) {
    const challenge = await this.challenge(roomId);
    let payload: PaymentPayload;
    let authorization: Authorization;
    try {
      if (signature.length > 16_384) throw new Error();
      payload = decodePaymentSignatureHeader(signature);
      authorization = authorizationSchema.parse(payload.payload.authorization);
      const expected = this.requirements();
      if (
        payload.x402Version !== 2 ||
        payload.accepted.scheme !== expected.scheme ||
        payload.accepted.network !== expected.network ||
        payload.accepted.asset.toLowerCase() !== expected.asset.toLowerCase() ||
        payload.accepted.payTo.toLowerCase() !== expected.payTo.toLowerCase() ||
        payload.accepted.amount !== expected.amount ||
        authorization.to.toLowerCase() !== expected.payTo.toLowerCase() ||
        typeof payload.payload.signature !== "string" ||
        !/^0x[0-9a-fA-F]+$/.test(payload.payload.signature)
      )
        throw new Error();
      if (
        payload.resource?.url &&
        payload.resource.url !== challenge.resource.url
      )
        throw new Error();
    } catch {
      throw new ServiceError(
        400,
        "INVALID_PAYMENT",
        "Expected an x402 v2 exact USDC/Base EIP-3009 payment for this room.",
      );
    }
    const identity = digest(
      `${PAYMENT_NETWORK}:${USDC_BASE.toLowerCase()}:${authorization.from.toLowerCase()}:${authorization.nonce.toLowerCase()}`,
    );
    const receiptKey = `ocn:payment:${identity}`;
    const keys = [receiptKey, roomKey(roomId)];
    const fingerprint = digest(
      JSON.stringify(authorization) + payload.payload.signature,
    );
    const database = this.service.database;
    const readRecord = (raw: string): ReceiptRecord | null =>
      raw ? JSON.parse(raw) : null;
    let record = readRecord(
      await database.eval<string>(paymentScript, keys, ["get"]),
    );
    const validateRecord = () => {
      if (
        record &&
        (record.room_id !== roomId || record.fingerprint !== fingerprint)
      )
        throw new ServiceError(
          409,
          "PAYMENT_REPLAY",
          "This authorization is bound to a different purchase. It cannot upgrade another room.",
        );
    };
    validateRecord();
    if (record?.paid_until) return this.result(record);
    const lockOwner = randomUUID();
    const lockKey = `${receiptKey}:lock`;
    const locked = await database.eval<string | null>(
      "return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', 60)",
      [lockKey],
      [lockOwner],
    );
    if (!locked)
      throw new ServiceError(
        409,
        "PAYMENT_PENDING",
        "Payment is processing. Retry the same PAYMENT-SIGNATURE in 60 seconds; do not sign another payment.",
      );
    try {
      record = readRecord(
        await database.eval<string>(paymentScript, keys, ["get"]),
      );
      validateRecord();
      if (record?.paid_until) return this.result(record);
      let settlement: SettleResponse | null = null;
      if (record)
        settlement = await this.gateway.recover(
          authorization,
          record.from_block,
          record.transaction,
        );
      if (!record) {
        const nowSeconds = Math.floor(this.service.now() / 1000);
        if (
          Number(authorization.validBefore) <= nowSeconds ||
          Number(authorization.validBefore) > nowSeconds + 305 ||
          Number(authorization.validAfter) >= nowSeconds
        )
          throw new ServiceError(
            402,
            "PAYMENT_EXPIRED",
            "Use a payment authorization valid now, expiring within five minutes.",
          );
        if (!(await this.gateway.verify(payload, this.requirements())))
          throw new ServiceError(
            402,
            "PAYMENT_REJECTED",
            "The facilitator could not verify this payment.",
          );
        const proposed: ReceiptRecord = {
          room_id: roomId,
          fingerprint,
          from_block: await this.gateway.blockNumber(),
        };
        record = readRecord(
          await database.eval<string>(paymentScript, keys, [
            "claim",
            JSON.stringify(proposed),
          ]),
        );
        if (!record)
          throw new ServiceError(
            404,
            "ROOM_NOT_FOUND",
            "Room expired before settlement.",
          );
        validateRecord();
      }
      if (
        !settlement &&
        !record.transaction &&
        Number(authorization.validBefore) >
          Math.floor(this.service.now() / 1000)
      ) {
        let response: SettleResponse;
        try {
          response = await this.gateway.settle(payload, this.requirements());
        } catch {
          throw new ServiceError(
            409,
            "PAYMENT_PENDING",
            "Settlement outcome is unknown. Retry the same PAYMENT-SIGNATURE; do not create a new payment.",
          );
        }
        if (
          response.success &&
          response.network === PAYMENT_NETWORK &&
          /^0x[0-9a-fA-F]{64}$/.test(response.transaction)
        ) {
          record = readRecord(
            await database.eval<string>(paymentScript, keys, [
              "transaction",
              fingerprint,
              response.transaction,
            ]),
          )!;
        }
        settlement = await this.gateway.recover(
          authorization,
          record.from_block,
          record.transaction,
        );
      }
      if (!settlement)
        throw new ServiceError(
          409,
          "PAYMENT_PENDING",
          "Awaiting two-block settlement confirmation. Retry the identical PAYMENT-SIGNATURE; do not pay again.",
        );
      record = readRecord(
        await database.eval<string>(paymentScript, keys, [
          "grant",
          fingerprint,
          this.service.now(),
          JSON.stringify(settlement),
        ]),
      );
      if (!record?.paid_until)
        throw new ServiceError(
          503,
          "PAYMENT_PENDING",
          "Settlement confirmed but upgrade is pending. Retry the same payment.",
        );
      return this.result(record);
    } finally {
      await database
        .eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
          [lockKey],
          [lockOwner],
        )
        .catch(() => undefined);
    }
  }

  private result(record: ReceiptRecord) {
    return {
      room_id: record.room_id,
      paid_until: record.paid_until!,
      participant_limit: null,
      duration_hours: day / 3_600_000,
      settlement: record.settlement!,
    };
  }
}

export function payments() {
  const config = paymentConfig();
  return new PaymentService(rooms, config, settlementGateway(config));
}
