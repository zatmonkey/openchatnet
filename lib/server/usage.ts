import { Redis } from "@upstash/redis";
import { usagePages } from "../usage-pages";
import type { Store } from "./store";

export const usageHour = 3_600_000;
export const usageRetentionHours = 30 * 24;
const operations = [
  "create_room",
  "room_info",
  "join_room",
  "heartbeat",
  "send_message",
  "read_messages",
  "wait_for_messages",
  "events",
  "leave_room",
  "upgrade_room",
  "unknown",
] as const;
export type UsageOperation = (typeof operations)[number];
export type UsageChannel = "http" | "mcp" | "mcp_transport";
const outcomes = [
  "success",
  "payment_required",
  "rate_limited",
  "client_error",
  "server_error",
] as const;
const allowedMetrics = new Set([
  ...["http", "mcp"].flatMap((channel) =>
    operations.flatMap((operation) =>
      outcomes.map((outcome) => `${channel}.${operation}.${outcome}`),
    ),
  ),
  ...outcomes.map((outcome) => `mcp_transport.request.${outcome}`),
  ...usagePages.map((page) => `page.${page}.success`),
]);

export function usageOutcome(status: number): (typeof outcomes)[number] {
  if (status === 402) return "payment_required";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  return "success";
}

export function httpUsageOperation(
  method: string,
  path: string[],
): UsageOperation {
  if (method === "POST" && path.length === 0) return "create_room";
  if (!path[0] || path.length > 2) return "unknown";
  if (method === "GET") {
    if (path.length === 1) return "room_info";
    if (path[1] === "messages") return "read_messages";
    if (path[1] === "wait") return "wait_for_messages";
    if (path[1] === "events") return "events";
  }
  if (method === "POST") {
    if (path[1] === "messages") return "send_message";
    if (path[1] === "join") return "join_room";
    if (path[1] === "heartbeat") return "heartbeat";
    if (path[1] === "leave") return "leave_room";
    if (path[1] === "upgrade") return "upgrade_room";
  }
  return "unknown";
}

export function usageKey(hour: number) {
  return `ocn:usage:v1:${hour}`;
}

const increment = `
local count = redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('EXPIREAT', KEYS[1], ARGV[2])
return count
`;
const read = `
local result = {}
for index, key in ipairs(KEYS) do
  result[index] = redis.call('HGETALL', key)
end
return result
`;

export class UsageService {
  constructor(
    private readonly database: Store,
    private readonly clock: () => number = Date.now,
  ) {}

  async record(metric: string, timestamp = this.clock()): Promise<boolean> {
    if (!allowedMetrics.has(metric) || !Number.isFinite(timestamp))
      return false;
    const hour = Math.floor(timestamp / usageHour);
    const currentHour = Math.floor(this.clock() / usageHour);
    if (hour > currentHour || hour <= currentHour - usageRetentionHours)
      return false;
    try {
      await this.database.eval<number>(
        increment,
        [usageKey(hour)],
        [metric, ((hour + usageRetentionHours) * usageHour) / 1000],
      );
      return true;
    } catch {
      return false;
    }
  }

  async report(days = 30) {
    if (!Number.isInteger(days) || days < 1 || days > 30)
      throw new Error("Usage window must be an integer from 1 to 30 days.");
    const currentHour = Math.floor(this.clock() / usageHour);
    const firstHour = currentHour - days * 24 + 1;
    const totals: Record<string, number> = {};
    const daily: Record<string, Record<string, number>> = {};
    let populatedHours = 0;
    for (let start = firstHour; start <= currentHour; start += 48) {
      const hours = Array.from(
        { length: Math.min(48, currentHour - start + 1) },
        (_, index) => start + index,
      );
      const buckets = await this.database.eval<string[][]>(
        read,
        hours.map(usageKey),
        [],
      );
      for (const [index, fields] of buckets.entries()) {
        if (fields.length) populatedHours++;
        const date = new Date(hours[index] * usageHour)
          .toISOString()
          .slice(0, 10);
        for (let field = 0; field < fields.length; field += 2) {
          const metric = fields[field];
          const count = Number(fields[field + 1]);
          if (
            !allowedMetrics.has(metric) ||
            !Number.isSafeInteger(count) ||
            count < 0
          )
            continue;
          totals[metric] = (totals[metric] || 0) + count;
          daily[date] ??= {};
          daily[date][metric] = (daily[date][metric] || 0) + count;
        }
      }
    }
    return {
      from: new Date(firstHour * usageHour).toISOString(),
      through: new Date(this.clock()).toISOString(),
      populated_hours: populatedHours,
      totals,
      daily,
    };
  }
}

let redis: Redis | undefined;
const usageStore: Store = {
  async eval<T>(script: string, keys: string[], args: (string | number)[]) {
    const url =
      process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token =
      process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error("Usage storage is not configured.");
    redis ??= new Redis({
      url,
      token,
      automaticDeserialization: false,
      retry: false,
      signal: () => AbortSignal.timeout(2000),
    });
    return (await redis.eval(script, keys, args)) as T;
  },
};

export const usage = new UsageService(usageStore);
