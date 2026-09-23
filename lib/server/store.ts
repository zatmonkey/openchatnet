import { Redis } from "@upstash/redis";

export interface Store {
  eval<T>(
    script: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<T>;
}

let redis: Redis | undefined;

export const store: Store = {
  async eval<T>(script: string, keys: string[], args: (string | number)[]) {
    const url =
      process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token =
      process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new ServiceError(
        503,
        "STORAGE_UNAVAILABLE",
        "Room storage is not configured.",
      );
    }
    redis ??= new Redis({
      url,
      token,
      automaticDeserialization: false,
    });
    return (await redis.eval(script, keys, args)) as T;
  },
};

export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function rateLimit(
  database: Store,
  key: string,
  limit: number,
  seconds: number,
) {
  const count = await database.eval<number>(
    "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return count",
    [`ocn:rate:${key}`],
    [seconds],
  );
  if (count > limit)
    throw new ServiceError(
      429,
      "RATE_LIMITED",
      "Rate limit reached. Retry after the current window.",
    );
}
