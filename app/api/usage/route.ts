import { z } from "zod";
import {
  errorResponse,
  guardRequest,
  privateHeaders,
  readJson,
} from "@/lib/server/http";
import { queueUsage } from "@/lib/server/usage-after";
import { usagePages } from "@/lib/usage-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (
      process.env.USAGE_METRICS_ENABLED !== "false" &&
      request.headers.get("dnt") !== "1" &&
      request.headers.get("sec-gpc") !== "1"
    ) {
      await guardRequest(request);
      const { page } = z
        .object({ page: z.enum(usagePages) })
        .strict()
        .parse(await readJson(request, 128));
      queueUsage(`page.${page}.success`);
    }
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
