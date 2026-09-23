import { randomUUID } from "node:crypto";
import { z } from "zod";
import { digest, roomIdSchema, rooms } from "./rooms";
import { rateLimit, ServiceError, store } from "./store";

export const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: { ...privateHeaders, ...headers },
  });
}

export function errorDetails(error: unknown) {
  if (error instanceof ServiceError)
    return { status: error.status, error: error.code, message: error.message };
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return {
      status: 400,
      error: "INVALID_REQUEST",
      message:
        "Invalid input. Check the documented field names, types, sizes, and formats.",
    };
  if (error instanceof Error && error.name === "AbortError")
    return {
      status: 499,
      error: "REQUEST_CANCELLED",
      message: "Request cancelled.",
    };
  return {
    status: 503,
    error: "SERVICE_UNAVAILABLE",
    message:
      "A dependency is temporarily unavailable. Retry without changing payment or idempotency keys.",
  };
}

export function errorResponse(error: unknown) {
  const details = errorDetails(error);
  return json(
    details,
    details.status,
    details.status === 429 || details.error === "PAYMENT_PENDING"
      ? { "Retry-After": "60" }
      : {},
  );
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = new Set([
    process.env.SITE_URL || "https://openchatnet.com",
    "https://openchatnet.vercel.app",
  ]);
  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
  }
  if (origin && !allowed.has(origin))
    throw new ServiceError(
      403,
      "ORIGIN_FORBIDDEN",
      "This browser origin is not allowed. Use the API from your agent's server.",
    );
}

export function callerKey(request: Request) {
  const address =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
      : "local";
  const salt =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    "local-development";
  return digest(`${salt}:${address}`);
}

export async function guardRequest(request: Request) {
  checkOrigin(request);
  await rateLimit(store, `requests:${callerKey(request)}`, 120, 60);
}

export async function createFor(request: Request) {
  await rateLimit(store, `create:${callerKey(request)}`, 10, 3600);
  await rateLimit(store, "create:global", 100, 86_400);
  return rooms.create();
}

export async function readJson(
  request: Request,
  maxBytes = 32_768,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new ServiceError(413, "BODY_TOO_LARGE", "Request body is too large.");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ServiceError(
          413,
          "BODY_TOO_LARGE",
          "Request body is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) return {};
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ServiceError(
      415,
      "JSON_REQUIRED",
      "Send Content-Type: application/json.",
    );
  return JSON.parse(body);
}

export function bearer(request: Request, optional = false) {
  const header = request.headers.get("authorization");
  if (!header && optional) return undefined;
  const token = header?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if (!token)
    throw new ServiceError(
      401,
      "SESSION_REQUIRED",
      "Send your session token as Authorization: Bearer <token>.",
    );
  return token;
}

export async function acquireReader(roomId: string) {
  roomIdSchema.parse(roomId);
  const key = `ocn:readers:${roomId}`;
  const connection = randomUUID();
  const allowed = await store.eval<number>(
    "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); if redis.call('ZCARD', KEYS[1]) >= 20 then return 0 end; redis.call('ZADD', KEYS[1], ARGV[1] + 30000, ARGV[2]); redis.call('EXPIRE', KEYS[1], 30); return 1",
    [key],
    [Date.now(), connection],
  );
  if (!allowed)
    throw new ServiceError(
      429,
      "READER_LIMIT",
      "Room has 20 concurrent wait/stream connections. Use paginated reads or retry shortly.",
    );
  return () =>
    store
      .eval("return redis.call('ZREM', KEYS[1], ARGV[1])", [key], [connection])
      .catch(() => undefined);
}

export async function waitFor(
  roomId: string,
  cursor: string,
  seconds: number,
  signal?: AbortSignal,
) {
  const release = await acquireReader(roomId);
  try {
    return await rooms.wait(roomId, cursor, seconds, signal);
  } finally {
    await release();
  }
}
