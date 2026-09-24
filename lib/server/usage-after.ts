import { after } from "next/server";
import {
  usage,
  usageOutcome,
  type UsageChannel,
  type UsageOperation,
} from "./usage";

export function queueUsage(metric: string) {
  if (process.env.USAGE_METRICS_ENABLED === "false") return;
  const timestamp = Date.now();
  try {
    after(async () => {
      await usage.record(metric, timestamp);
    });
  } catch {}
}

export function recordOperation(
  channel: UsageChannel,
  operation: UsageOperation | "request",
  status: number,
) {
  queueUsage(`${channel}.${operation}.${usageOutcome(status)}`);
}
