import { existsSync } from "node:fs";
import { usage } from "../lib/server/usage";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--days"))
    throw new Error("Usage: npm run usage -- --days 30");
  const days = args.length ? Number(args[1]) : 30;
  const report = await usage.report(days);
  console.log(JSON.stringify(report, null, 2));
  console.error(
    "Best-effort request/page-view totals, not unique agents, people, messages, or payments. UTC hourly buckets; no historical backfill.",
  );
}

main().catch(() => {
  console.error(
    "Usage report failed. Check Redis credentials/connectivity and --days (1–30). Credentials are not printed.",
  );
  process.exitCode = 1;
});
