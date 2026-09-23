import { setTimeout as delay } from "node:timers/promises";
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { z } from "zod";
import {
  acquireReader,
  bearer,
  createFor,
  errorDetails,
  errorResponse,
  guardRequest,
  json,
  privateHeaders,
  readJson,
  waitFor,
} from "@/lib/server/http";
import { cursorSchema, roomIdSchema, rooms } from "@/lib/server/rooms";
import { payments } from "@/lib/server/payments";
import { ServiceError } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ path?: string[] }> };

async function stream(request: Request, roomId: string, initialCursor: string) {
  let cursor = cursorSchema.parse(initialCursor);
  const first = await rooms.read(roomId, cursor);
  const release = await acquireReader(roomId);
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(output) {
      const end = Date.now() + 25_000;
      let page = first;
      let reportedGap = false;
      const emit = (value: string) => {
        signal.throwIfAborted();
        output.enqueue(encoder.encode(value));
      };
      try {
        emit("retry: 2000\n\n");
        while (!signal.aborted && Date.now() < end) {
          if (page.history_gap && !reportedGap) {
            emit(
              `event: history_gap\ndata: ${JSON.stringify({ after_cursor: cursor })}\n\n`,
            );
            reportedGap = true;
          }
          for (const message of page.messages)
            emit(
              `id: ${message.id}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`,
            );
          cursor = page.next_cursor;
          emit(": keepalive\n\n");
          if (!page.has_more) await delay(2000, undefined, { signal });
          page = await rooms.read(roomId, cursor);
        }
        emit(
          `event: reconnect\ndata: ${JSON.stringify({ next_cursor: cursor })}\n\n`,
        );
      } catch (error) {
        if (!signal.aborted)
          emit(
            `event: error\ndata: ${JSON.stringify(errorDetails(error))}\n\n`,
          );
      } finally {
        await release();
        if (!signal.aborted) output.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(body, {
    headers: {
      ...privateHeaders,
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handle(request: Request, context: Context) {
  try {
    await guardRequest(request);
    const path = (await context.params).path || [];
    if (path.length === 0 && request.method === "POST")
      return json(await createFor(request), 201);
    if (path.length > 2 || !path[0])
      throw new ServiceError(404, "NOT_FOUND", "Endpoint not found.");
    const roomId = roomIdSchema.parse(path[0]);
    const operation = path[1];
    const url = new URL(request.url);
    if (request.method === "GET") {
      if (!operation) return json(await rooms.info(roomId));
      const after =
        url.searchParams.get("after") ||
        request.headers.get("last-event-id") ||
        "0-0";
      if (operation === "messages")
        return json(
          await rooms.read(
            roomId,
            after,
            Number(url.searchParams.get("limit") || 100),
          ),
        );
      if (operation === "wait")
        return json(
          await waitFor(
            roomId,
            after,
            Number(url.searchParams.get("timeout_seconds") || 25),
            request.signal,
          ),
        );
      if (operation === "events") return await stream(request, roomId, after);
    }
    if (request.method === "POST") {
      if (operation === "upgrade") {
        const service = payments();
        const signature = request.headers.get("payment-signature");
        if (!signature) {
          const challenge = await service.challenge(roomId);
          return json(challenge, 402, {
            "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
          });
        }
        try {
          const result = await service.upgrade(roomId, signature);
          return json(result, 200, {
            "PAYMENT-RESPONSE": encodePaymentResponseHeader(result.settlement),
          });
        } catch (error) {
          if (error instanceof ServiceError && error.status === 402) {
            const challenge = {
              ...(await service.challenge(roomId)),
              error: error.code,
            };
            return json(challenge, 402, {
              "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
            });
          }
          throw error;
        }
      }
      if (operation === "join") {
        const body = z
          .object({ name: z.string() })
          .strict()
          .parse(await readJson(request));
        return json(await rooms.join(roomId, body.name, bearer(request, true)));
      }
      if (operation === "heartbeat")
        return json(await rooms.heartbeat(roomId, bearer(request)!));
      if (operation === "leave")
        return json(await rooms.leave(roomId, bearer(request)!));
      if (operation === "messages") {
        const content = z
          .object({
            text: z.string().optional(),
            data: z.json().optional(),
            idempotency_key: z.string().optional(),
          })
          .strict()
          .parse(await readJson(request, 8192));
        return json(
          await rooms.send(roomId, bearer(request)!, {
            ...content,
            idempotency_key:
              request.headers.get("idempotency-key") || content.idempotency_key,
          }),
          201,
        );
      }
    }
    throw new ServiceError(
      405,
      "METHOD_NOT_ALLOWED",
      "Unsupported method or room operation.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = handle;
export const POST = handle;
