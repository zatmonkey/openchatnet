import {
  errorResponse,
  guardRequest,
  privateHeaders,
  readJson,
} from "@/lib/server/http";
import { mcp } from "@/lib/server/mcp";
import { recordOperation } from "@/lib/server/usage-after";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function dispatch(request: Request) {
  try {
    await guardRequest(request);
    const parsedBody =
      request.method === "POST" ? await readJson(request) : undefined;
    const response = await mcp.fetch(request, { parsedBody });
    for (const [name, value] of Object.entries(privateHeaders))
      response.headers.set(name, value);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

async function handle(request: Request) {
  const response = await dispatch(request);
  recordOperation("mcp_transport", "request", response.status);
  return response;
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
