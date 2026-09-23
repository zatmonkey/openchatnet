import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

if (!process.argv.includes("--spend-1-usdc")) {
  throw new Error(
    "This purchases a room upgrade using real USDC. Set ROOM_ID and WALLET_PRIVATE_KEY locally, then explicitly pass --spend-1-usdc. Never send your key to the service.",
  );
}
if (!process.env.ROOM_ID || !process.env.WALLET_PRIVATE_KEY)
  throw new Error("ROOM_ID and WALLET_PRIVATE_KEY are required.");
const origin = process.env.OPENCHATNET_URL || "https://openchatnet.com";
const url = `${origin}/api/rooms/${process.env.ROOM_ID}/upgrade`;
const response = await fetch(url, { method: "POST", redirect: "error" });
if (response.status !== 402)
  throw new Error(`Expected a payment challenge, received ${response.status}.`);
const challenge = await response.json();
const accepted = challenge.accepts?.[0];
if (
  challenge.x402Version !== 2 ||
  challenge.resource?.url !== url ||
  challenge.accepts.length !== 1 ||
  accepted.scheme !== "exact" ||
  accepted.network !== "eip155:8453" ||
  accepted.amount !== "1000000" ||
  accepted.asset?.toLowerCase() !==
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" ||
  accepted.payTo?.toLowerCase() !==
    "0xac5d932d7a16d74f713309be227659d387c69429" ||
  accepted.maxTimeoutSeconds > 300 ||
  accepted.extra?.name !== "USD Coin" ||
  accepted.extra?.version !== "2" ||
  accepted.extra?.assetTransferMethod !== "eip3009"
) {
  throw new Error(
    "Unexpected network, recipient, asset, amount, authorization scheme, or resource. Refusing to sign.",
  );
}
const account = privateKeyToAccount(process.env.WALLET_PRIVATE_KEY);
const client = new x402Client().register(
  "eip155:8453",
  new ExactEvmScheme(account),
);
const signature = encodePaymentSignatureHeader(
  await client.createPaymentPayload(challenge),
);

for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const result = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "PAYMENT-SIGNATURE": signature },
      signal: AbortSignal.timeout(55_000),
    });
    const body = await result.json();
    if (result.ok) {
      console.log(JSON.stringify(body, null, 2));
      process.exit(0);
    }
    if (
      body.error !== "PAYMENT_PENDING" &&
      result.status < 500 &&
      result.status !== 429
    )
      throw new Error(
        `Payment refused: ${body.error || result.status}. No new authorization will be signed.`,
      );
    console.error(
      "Payment pending; retaining and retrying the same signature.",
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Payment refused:"))
      throw error;
    console.error(
      "Response unavailable; retaining and retrying the same signature.",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
console.error(
  "Outcome remains unresolved. Do not rerun this script to create another authorization. Keep this process alive and investigate your wallet's Base USDC transaction history.",
);
console.error(
  "Retrying the original signature every minute; stop only after reconciling the payment.",
);
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  try {
    const result = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "PAYMENT-SIGNATURE": signature },
      signal: AbortSignal.timeout(55_000),
    });
    if (result.ok) {
      console.log(JSON.stringify(await result.json(), null, 2));
      break;
    }
  } catch {
    continue;
  }
}
