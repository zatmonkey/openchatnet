import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { RedisMemoryServer } from "redis-memory-server";
import Redis from "ioredis";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { RoomService, roomKey } from "../lib/server/rooms";
import {
  PaymentService,
  USDC_BASE,
  type PaymentConfig,
  type SettlementGateway,
} from "../lib/server/payments";
import { ServiceError, type Store } from "../lib/server/store";

let server: RedisMemoryServer;
let redis: Redis;
let service: RoomService;
let now: number;
const day = 86_400_000;
const database: Store = {
  async eval<T>(script: string, keys: string[], args: (string | number)[]) {
    return (await redis.eval(script, keys.length, ...keys, ...args)) as T;
  },
};

before(async () => {
  server = await RedisMemoryServer.create();
  redis = new Redis(await server.getPort(), await server.getHost());
});
beforeEach(async () => {
  await redis.flushdb();
  now = Date.now();
  service = new RoomService(database, () => now);
});
after(async () => {
  await redis?.quit();
  await server?.stop();
});

async function joined() {
  const room = await service.create();
  return { room, participant: await service.join(room.room_id, "builder") };
}

test("concurrent admission grants exactly three free slots and resumes without another slot", async () => {
  const room = await service.create();
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) =>
      service.join(room.room_id, `agent-${index}`),
    ),
  );
  assert.equal(
    attempts.filter((entry) => entry.status === "fulfilled").length,
    3,
  );
  assert.equal((await service.info(room.room_id)).active_participants, 3);
  const first = attempts.find((entry) => entry.status === "fulfilled");
  assert.ok(first?.status === "fulfilled");
  const resumed = await service.join(
    room.room_id,
    "ignored-name",
    first.value.session_token,
  );
  assert.equal(resumed.participant_id, first.value.participant_id);
  await service.leave(room.room_id, resumed.session_token);
  await service.join(room.room_id, "replacement");
});

test("leases expire after 90 seconds; heartbeat extends only its session", async () => {
  const { room, participant } = await joined();
  await service.join(room.room_id, "second");
  now += 60_000;
  await service.heartbeat(room.room_id, participant.session_token);
  now += 30_001;
  assert.equal((await service.info(room.room_id)).active_participants, 1);
  now += 60_000;
  await assert.rejects(
    service.heartbeat(room.room_id, participant.session_token),
    { code: "SESSION_EXPIRED" },
  );
  assert.equal((await service.info(room.room_id)).active_participants, 0);
});

test("idempotent sends return the original message and reject changed content", async () => {
  const { room, participant } = await joined();
  const content = { text: "ready", idempotency_key: "job-1" };
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      service.send(room.room_id, participant.session_token, content),
    ),
  );
  assert.equal(new Set(results.map((message) => message.id)).size, 1);
  assert.equal((await service.read(room.room_id)).messages.length, 1);
  await assert.rejects(
    service.send(room.room_id, participant.session_token, {
      ...content,
      text: "different",
    }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
});

test("each message expires independently, including its deduplication copy", async () => {
  const { room, participant } = await joined();
  const old = await service.send(room.room_id, participant.session_token, {
    text: "old",
    idempotency_key: "old",
  });
  const payloadKeys = await redis.keys(`${roomKey(room.room_id)}:message:*`);
  const dedupeKeys = await redis.keys(`${roomKey(room.room_id)}:dedupe:*`);
  for (const key of [...payloadKeys, ...dedupeKeys])
    assert.ok(
      (await redis.pttl(key)) <= day && (await redis.pttl(key)) > day - 5000,
    );
  now += day - 1000;
  const later = await service.join(room.room_id, "later");
  await service.send(room.room_id, later.session_token, {
    text: "new",
    idempotency_key: "new",
  });
  now += 1000;
  const page = await service.read(room.room_id, old.id);
  assert.equal(page.history_gap, true);
  assert.deepEqual(
    page.messages.map((message) => message.text),
    ["new"],
  );
  assert.equal((await service.info(room.room_id)).room_id, room.room_id);
});

test("pagination is ordered and lossless for messages with identical timestamps", async () => {
  const { room, participant } = await joined();
  for (let index = 0; index < 12; index++)
    await service.send(room.room_id, participant.session_token, {
      text: String(index),
      idempotency_key: String(index),
    });
  const first = await service.read(room.room_id, "0-0", 5);
  const second = await service.read(room.room_id, first.next_cursor, 5);
  const third = await service.read(room.room_id, second.next_cursor, 5);
  assert.equal(first.has_more, true);
  assert.equal(third.has_more, false);
  assert.deepEqual(
    [...first.messages, ...second.messages, ...third.messages].map(
      (message) => message.text,
    ),
    Array.from({ length: 12 }, (_, index) => String(index)),
  );
});

test("an empty expired history advances the cursor so waits do not spin", async () => {
  const { room, participant } = await joined();
  const message = await service.send(room.room_id, participant.session_token, {
    text: "expired",
    idempotency_key: "expired",
  });
  now += day;
  const page = await service.read(room.room_id, message.id);
  assert.equal(page.history_gap, true);
  assert.deepEqual(page.messages, []);
  assert.notEqual(page.next_cursor, message.id);
  const next = await service.wait(room.room_id, page.next_cursor, 0);
  assert.equal(next.history_gap, false);
});

test("message rate and storage limits fail closed", async () => {
  const { room, participant } = await joined();
  await redis.set(`${roomKey(room.room_id)}:rate`, "300", "EX", 60);
  await assert.rejects(
    service.send(room.room_id, participant.session_token, {
      text: "limited",
      idempotency_key: "rate",
    }),
    { code: "RATE_LIMITED" },
  );
  await redis.del(`${roomKey(room.room_id)}:rate`);
  const pipeline = redis.pipeline();
  for (let index = 0; index < 1000; index++)
    pipeline.zadd(`${roomKey(room.room_id)}:messages`, now, `${now}-${index}`);
  await pipeline.exec();
  await assert.rejects(
    service.send(room.room_id, participant.session_token, {
      text: "limited",
      idempotency_key: "storage",
    }),
    { code: "ROOM_STORAGE_FULL" },
  );
});

test("structured JSON preserves arrays, null, booleans, and nested objects", async () => {
  const { room, participant } = await joined();
  const data = { tasks: [], completed: [false, null, { empty: {} }] };
  const message = await service.send(room.room_id, participant.session_token, {
    data,
    idempotency_key: "json",
  });
  assert.deepEqual(message.data, data);
  assert.deepEqual((await service.read(room.room_id)).messages[0].data, data);
});

test("wrong-room tokens and oversized messages are rejected", async () => {
  const { participant } = await joined();
  const other = await service.create();
  await assert.rejects(
    service.send(other.room_id, participant.session_token, {
      text: "no",
      idempotency_key: "no",
    }),
    { code: "SESSION_EXPIRED" },
  );
  await assert.rejects(
    service.send(other.room_id, participant.session_token, {
      text: "💬".repeat(2000),
      idempotency_key: "big",
    }),
    { code: "MESSAGE_TOO_LARGE" },
  );
});

test("bounded waits return immediately on data or history gap and support cancellation", async () => {
  const { room, participant } = await joined();
  assert.deepEqual((await service.wait(room.room_id, "0-0", 0)).messages, []);
  await service.send(room.room_id, participant.session_token, {
    text: "hello",
    idempotency_key: "hello",
  });
  assert.equal(
    (await service.wait(room.room_id, "0-0", 25)).messages.length,
    1,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.wait(room.room_id, "0-0", 25, controller.signal),
    { name: "AbortError" },
  );
});

const config: PaymentConfig = {
  payTo: "0x1111111111111111111111111111111111111111",
  origin: "https://openchatnet.com",
  facilitatorUrl: "https://example.invalid",
  rpcUrl: "https://example.invalid",
};
const settled: SettleResponse = {
  success: true,
  network: "eip155:8453",
  transaction: `0x${"a".repeat(64)}`,
  payer: "0x2222222222222222222222222222222222222222",
};

function paymentFixture() {
  let settlements = 0;
  let verified = true;
  let confirmed = false;
  let confirmationAllowed = true;
  let timeoutAfterSettlement = false;
  const gateway: SettlementGateway = {
    async blockNumber() {
      return "100";
    },
    async verify() {
      return verified;
    },
    async settle() {
      settlements++;
      confirmed = true;
      if (timeoutAfterSettlement) throw new Error("lost response");
      return settled;
    },
    async recover() {
      return confirmed && confirmationAllowed ? settled : null;
    },
  };
  const payments = new PaymentService(service, config, gateway);
  function payload(roomId: string, nonce = "1"): PaymentPayload {
    return {
      x402Version: 2,
      resource: { url: `${config.origin}/api/rooms/${roomId}/upgrade` },
      accepted: payments.requirements(),
      payload: {
        signature: `0x${"a".repeat(130)}`,
        authorization: {
          from: settled.payer!,
          to: config.payTo,
          value: "1000000",
          validAfter: String(Math.floor(now / 1000) - 10),
          validBefore: String(Math.floor(now / 1000) + 250),
          nonce: `0x${nonce.repeat(64)}`,
        },
      },
    };
  }
  return {
    payments,
    payload,
    settlements: () => settlements,
    confirmation: (allowed: boolean) => {
      confirmationAllowed = allowed;
    },
    reject: () => {
      verified = false;
    },
    timeout: () => {
      timeoutAfterSettlement = true;
    },
  };
}

test("x402 challenge requires exactly 1 USDC on Base; no payment grants nothing", async () => {
  const { room } = await joined();
  const fixture = paymentFixture();
  const challenge = await fixture.payments.challenge(room.room_id);
  assert.equal(challenge.accepts[0].amount, "1000000");
  assert.equal(challenge.accepts[0].asset, USDC_BASE);
  assert.equal((await service.info(room.room_id)).paid_until, 0);
  await assert.rejects(fixture.payments.upgrade(room.room_id, "not-json"), {
    code: "INVALID_PAYMENT",
  });
});

test("unverified or altered payment cannot unlock a room", async () => {
  const { room } = await joined();
  const fixture = paymentFixture();
  fixture.reject();
  await assert.rejects(
    fixture.payments.upgrade(
      room.room_id,
      encodePaymentSignatureHeader(fixture.payload(room.room_id)),
    ),
    { code: "PAYMENT_REJECTED" },
  );
  const altered = fixture.payload(room.room_id);
  altered.accepted.amount = "1";
  await assert.rejects(
    fixture.payments.upgrade(
      room.room_id,
      encodePaymentSignatureHeader(altered),
    ),
    { code: "INVALID_PAYMENT" },
  );
  assert.equal(fixture.settlements(), 0);
  assert.equal((await service.info(room.room_id)).paid_until, 0);
});

test("settlement and its retries extend a room exactly once; nonce cannot move rooms", async () => {
  const { room } = await joined();
  const fixture = paymentFixture();
  const header = encodePaymentSignatureHeader(fixture.payload(room.room_id));
  const first = await fixture.payments.upgrade(room.room_id, header);
  const retry = await fixture.payments.upgrade(room.room_id, header);
  assert.equal(first.paid_until, now + day);
  assert.deepEqual(retry, first);
  assert.equal(fixture.settlements(), 1);
  const other = await service.create();
  await assert.rejects(
    fixture.payments.upgrade(
      other.room_id,
      encodePaymentSignatureHeader(fixture.payload(other.room_id)),
    ),
    { code: "PAYMENT_REPLAY" },
  );
  const secondPurchase = await fixture.payments.upgrade(
    room.room_id,
    encodePaymentSignatureHeader(fixture.payload(room.room_id, "2")),
  );
  assert.equal(secondPurchase.paid_until, now + day * 2);
});

test("wrong network, token, and recipient are rejected before settlement", async () => {
  const { room } = await joined();
  const fixture = paymentFixture();
  for (const field of ["network", "asset", "payTo"] as const) {
    const payload = fixture.payload(room.room_id);
    if (field === "network") payload.accepted.network = "eip155:1";
    else payload.accepted[field] = "0x3333333333333333333333333333333333333333";
    await assert.rejects(
      fixture.payments.upgrade(
        room.room_id,
        encodePaymentSignatureHeader(payload),
      ),
      { code: "INVALID_PAYMENT" },
    );
  }
  assert.equal(fixture.settlements(), 0);
});

test("a facilitator success without chain confirmation cannot grant access", async () => {
  const { room } = await joined();
  const fixture = paymentFixture();
  fixture.confirmation(false);
  const header = encodePaymentSignatureHeader(fixture.payload(room.room_id));
  await assert.rejects(fixture.payments.upgrade(room.room_id, header), {
    code: "PAYMENT_PENDING",
  });
  assert.equal((await service.info(room.room_id)).paid_until, 0);
  fixture.confirmation(true);
  assert.equal(
    (await fixture.payments.upgrade(room.room_id, header)).paid_until,
    now + day,
  );
  assert.equal(fixture.settlements(), 1);
});

test("lost settlement responses recover without another charge or extension", async () => {
  const { room } = await joined();
  const fixture = paymentFixture();
  fixture.timeout();
  const header = encodePaymentSignatureHeader(fixture.payload(room.room_id));
  await assert.rejects(fixture.payments.upgrade(room.room_id, header), {
    code: "PAYMENT_PENDING",
  });
  const recovered = await fixture.payments.upgrade(room.room_id, header);
  assert.equal(recovered.paid_until, now + day);
  assert.equal(fixture.settlements(), 1);
});

test("concurrent payment retries cannot duplicate settlement", async () => {
  const { room } = await joined();
  const fixture = paymentFixture();
  const header = encodePaymentSignatureHeader(fixture.payload(room.room_id));
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      fixture.payments.upgrade(room.room_id, header),
    ),
  );
  assert.ok(attempts.some((entry) => entry.status === "fulfilled"));
  for (const entry of attempts)
    if (entry.status === "rejected")
      assert.ok(
        entry.reason instanceof ServiceError &&
          entry.reason.code === "PAYMENT_PENDING",
      );
  assert.equal(fixture.settlements(), 1);
  assert.equal((await service.info(room.room_id)).paid_until, now + day);
});

test("paid rooms admit more than three; expiry keeps earliest three active senders", async () => {
  const { room, participant } = await joined();
  const fixture = paymentFixture();
  await fixture.payments.upgrade(
    room.room_id,
    encodePaymentSignatureHeader(fixture.payload(room.room_id)),
  );
  const sessions = [participant];
  for (let index = 0; index < 4; index++)
    sessions.push(await service.join(room.room_id, `extra-${index}`));
  now += day - 30_000;
  for (const session of sessions)
    await redis.zadd(
      `${roomKey(room.room_id)}:leases`,
      now + 90_000,
      (await import("../lib/server/rooms")).digest(session.session_token),
    );
  now += 30_001;
  assert.equal((await service.info(room.room_id)).participant_limit, 3);
  assert.equal(
    (await service.heartbeat(room.room_id, sessions[3].session_token)).can_send,
    false,
  );
  await assert.rejects(
    service.send(room.room_id, sessions[3].session_token, {
      text: "over cap",
      idempotency_key: randomUUID(),
    }),
    { code: "ROOM_FULL" },
  );
  await service.leave(room.room_id, sessions[0].session_token);
  await service.send(room.room_id, sessions[3].session_token, {
    text: "slot freed",
    idempotency_key: randomUUID(),
  });
});
