import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { roomScript } from "./room-script";
import { ServiceError, store, type Store } from "./store";

export const roomIdSchema = z.uuid();
export const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const cursorSchema = z
  .string()
  .regex(/^\d{1,13}-\d{1,12}$/)
  .default("0-0");
export const messageSchema = z
  .object({
    text: z.string().max(4096).optional(),
    data: z.json().optional(),
    idempotency_key: z.string().min(1).max(128),
  })
  .strict()
  .refine(
    (value) => Boolean(value.text?.trim()) || value.data !== undefined,
    "Provide text or data.",
  );

export interface Message {
  id: string;
  participant_id: string;
  name: string;
  text?: string;
  data?: unknown;
  created_at: number;
  expires_at: number;
}

export interface MessagePage {
  messages: Message[];
  next_cursor: string;
  has_more: boolean;
  history_gap: boolean;
}

function decodeMessage(message: Message & { data_json?: string }) {
  const { data_json, ...value } = message;
  return data_json === undefined
    ? value
    : { ...value, data: JSON.parse(data_json) };
}

export interface RoomInfo {
  room_id: string;
  created_at: number;
  paid_until: number;
  participant_limit: number | null;
  active_participants: number;
  message_retention_hours: number;
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function roomKey(roomId: string) {
  return `ocn:room:${roomIdSchema.parse(roomId)}`;
}

const errors: Record<string, [number, string]> = {
  ROOM_NOT_FOUND: [404, "Room not found or idle for seven days."],
  ROOM_FULL: [
    409,
    "Three sending sessions are available. Upgrade this room for more.",
  ],
  SESSION_EXPIRED: [401, "Session missing or expired. Join again."],
  IDEMPOTENCY_CONFLICT: [
    409,
    "This idempotency key was used for different content.",
  ],
  ROOM_STORAGE_FULL: [
    429,
    "Room has 1,000 unexpired messages. Wait for messages to expire.",
  ],
  RATE_LIMITED: [429, "Message rate limit reached. Retry in 60 seconds."],
};

export class RoomService {
  constructor(
    public database: Store = store,
    public now: () => number = Date.now,
  ) {}

  private async execute<T>(
    roomId: string,
    operation: string,
    input: object = {},
  ): Promise<T> {
    const key = roomKey(roomId);
    const raw = await this.database.eval<string>(
      roomScript,
      [
        key,
        `${key}:leases`,
        `${key}:participants`,
        `${key}:order`,
        `${key}:messages`,
      ],
      [operation, this.now(), JSON.stringify({ room_id: roomId, ...input })],
    );
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (result.error) {
      const [status, message] = errors[result.error] ?? [
        409,
        "Operation could not be completed.",
      ];
      throw new ServiceError(status, result.error, message);
    }
    return result as T;
  }

  async create() {
    return this.execute<{
      room_id: string;
      message_retention_hours: number;
      participant_limit: number;
    }>(randomUUID(), "create");
  }

  info(roomId: string) {
    return this.execute<RoomInfo>(roomId, "info");
  }

  async join(roomId: string, name: string, resumeToken?: string) {
    const validName = z.string().trim().min(1).max(64).parse(name);
    const token = resumeToken
      ? tokenSchema.parse(resumeToken)
      : randomBytes(32).toString("hex");
    const participant = await this.execute<{
      participant_id: string;
      name: string;
      can_send: boolean;
    }>(roomId, "join", {
      name: validName,
      participant_id: randomUUID(),
      token_hash: digest(token),
      resume: Boolean(resumeToken),
    });
    return {
      ...participant,
      session_token: token,
      heartbeat_interval_seconds: 30,
      lease_expires_at: this.now() + 90_000,
    };
  }

  heartbeat(roomId: string, token: string) {
    return this.execute<{ lease_expires_at: number; can_send: boolean }>(
      roomId,
      "heartbeat",
      { token_hash: digest(tokenSchema.parse(token)) },
    );
  }

  leave(roomId: string, token: string) {
    return this.execute<{ left: boolean }>(roomId, "leave", {
      token_hash: digest(tokenSchema.parse(token)),
    });
  }

  async send(roomId: string, token: string, content: unknown) {
    const { idempotency_key, ...message } = messageSchema.parse(content);
    const encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded) > 4096)
      throw new ServiceError(
        413,
        "MESSAGE_TOO_LARGE",
        "Text and JSON together must fit in 4 KiB.",
      );
    const result = await this.execute<Message>(roomId, "send", {
      text: message.text,
      data_json:
        message.data === undefined ? undefined : JSON.stringify(message.data),
      token_hash: digest(tokenSchema.parse(token)),
      idempotency_hash: digest(idempotency_key),
      fingerprint: digest(encoded),
    });
    return decodeMessage(result);
  }

  async read(roomId: string, after = "0-0", limit = 100) {
    const page = await this.execute<MessagePage>(roomId, "read", {
      after: cursorSchema.parse(after),
      limit: z.number().int().min(1).max(100).parse(limit),
    });
    if (!Array.isArray(page.messages)) page.messages = [];
    page.messages = page.messages.map(decodeMessage);
    return page;
  }

  async wait(
    roomId: string,
    after = "0-0",
    timeoutSeconds = 25,
    signal?: AbortSignal,
  ) {
    z.number().int().min(0).max(25).parse(timeoutSeconds);
    const deadline = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      signal?.throwIfAborted();
      const page = await this.read(roomId, after);
      if (page.messages.length || page.history_gap || Date.now() >= deadline)
        return page;
      await delay(
        Math.min(2000, Math.max(1, deadline - Date.now())),
        undefined,
        { signal },
      );
    }
  }
}

export const rooms = new RoomService();
