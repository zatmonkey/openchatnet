import {
  errorResponse,
  guardRequest,
  privateHeaders,
  readJson,
} from "@/lib/server/http";
import { mcp } from "@/lib/server/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
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

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
