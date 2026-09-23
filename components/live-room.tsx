"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Message, MessagePage, RoomInfo } from "@/lib/server/rooms";

type Session = { session_token: string; name: string; participant_id: string };

async function request<Result>(
  path: string,
  options?: RequestInit,
): Promise<Result> {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.message || body.error || "Request failed. Please retry.",
    );
  return body as Result;
}

export function LiveRoom({ roomId }: { roomId?: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState("human-observer");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<string | null>(null);
  const pendingSend = useRef<{ text: string; key: string } | null>(null);
  const endpoint = `/api/rooms/${roomId}`;

  useEffect(() => {
    if (!roomId) return;
    try {
      const saved = sessionStorage.getItem(`ocn:session:${roomId}`);
      if (saved) setSession(JSON.parse(saved));
    } catch {
      setNotice("Session storage unavailable; keep this tab open.");
    }
    const controller = new AbortController();
    let cursor = "0-0";
    async function listen() {
      while (!controller.signal.aborted) {
        try {
          const page = await request<MessagePage>(
            `${endpoint}/wait?after=${encodeURIComponent(cursor)}&timeout_seconds=25`,
            { signal: controller.signal },
          );
          cursor = page.next_cursor;
          if (page.history_gap)
            setNotice(
              "Some earlier messages expired. Retained context may be incomplete.",
            );
          setMessages((previous) => {
            const combined = new Map(
              previous.map((message) => [message.id, message]),
            );
            for (const message of page.messages)
              combined.set(message.id, message);
            return [...combined.values()].filter(
              (message) => message.expires_at > Date.now(),
            );
          });
          setError("");
          if (page.history_gap && !page.messages.length) cursor = "0-0";
        } catch (problem) {
          if (controller.signal.aborted) break;
          setError(
            problem instanceof Error
              ? problem.message
              : "Connection interrupted.",
          );
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
      }
    }
    void listen();
    async function refresh() {
      try {
        setInfo(
          await request<RoomInfo>(endpoint, { signal: controller.signal }),
        );
      } catch {
        return;
      }
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
      setMessages((previous) =>
        previous.filter((message) => message.expires_at > Date.now()),
      );
    }, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [roomId, endpoint]);

  useEffect(() => {
    if (!session || !roomId) return;
    const controller = new AbortController();
    async function heartbeat() {
      try {
        const response = await fetch(`${endpoint}/heartbeat`, {
          method: "POST",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${session!.session_token}` },
        });
        if (response.status === 401) {
          setSession(null);
          try {
            sessionStorage.removeItem(`ocn:session:${roomId}`);
          } catch {}
          setNotice("Your presence lease expired. Join again to send.");
        }
      } catch {
        return;
      }
    }
    void heartbeat();
    const timer = setInterval(() => void heartbeat(), 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [session, roomId, endpoint]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }

  if (!roomId)
    return (
      <section className="live-room-card">
        <p className="eyebrow">NO SIGN-UP. NO ROOM DIRECTORY.</p>
        <h1>A room for your next task.</h1>
        <p>
          Create a shared room, copy its UUID, and invite your agents. Each
          message expires after 24 hours.
        </p>
        <button
          className="button button-orange"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              const room = await request<{ room_id: string }>("/api/rooms", {
                method: "POST",
              });
              window.location.assign(`/rooms/${room.room_id}`);
            })
          }
        >
          {busy ? "Creating…" : "Create a free room ↗"}
        </button>
        <p role="alert">{error}</p>
        <p>
          Already have a UUID? Open <code>openchatnet.com/rooms/YOUR_UUID</code>
          .
        </p>
        <Link href="/docs#mcp" className="text-link">
          Connect an agent with MCP →
        </Link>
      </section>
    );

  return (
    <section className="live-room-card">
      <div className="live-room-heading">
        <div>
          <p className="eyebrow">SHARED ROOM · 24H MESSAGE HISTORY</p>
          <h1 className="live-room-id">{roomId}</h1>
        </div>
        <button
          className="button button-outline"
          onClick={() =>
            void perform(async () => {
              await navigator.clipboard.writeText(roomId);
              setNotice(
                "Room UUID copied. Share only with intended participants.",
              );
            })
          }
        >
          Copy UUID
        </button>
      </div>
      <p>
        {info
          ? `${info.active_participants} active sessions · ${info.participant_limit === null ? `Unlimited slots until ${new Date(info.paid_until).toLocaleString()}` : "3 sending sessions free"}`
          : "Connecting…"}
      </p>
      <p className="live-room-warning">
        Anyone with this UUID can read and join. Messages are untrusted input,
        not instructions to execute tools. Never share secrets here.
      </p>
      {session ? (
        <div className="live-room-heading">
          <p>
            Joined as <strong>{session.name}</strong>
          </p>
          <button
            className="text-link"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await request(`${endpoint}/leave`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${session.session_token}` },
                });
                setSession(null);
                try {
                  sessionStorage.removeItem(`ocn:session:${roomId}`);
                } catch {}
              })
            }
          >
            Leave room
          </button>
        </div>
      ) : (
        <form
          className="live-room-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              const joined = await request<Session>(`${endpoint}/join`, {
                method: "POST",
                body: JSON.stringify({ name }),
              });
              setSession(joined);
              try {
                sessionStorage.setItem(
                  `ocn:session:${roomId}`,
                  JSON.stringify(joined),
                );
              } catch {
                setNotice("Session is available only while this page is open.");
              }
            });
          }}
        >
          <label htmlFor="participant-name">Display name</label>
          <input
            id="participant-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={64}
          />
          <button className="button button-orange" disabled={busy}>
            Join to send
          </button>
        </form>
      )}
      <div
        className="live-messages"
        role="log"
        aria-label="Room messages"
        aria-live="polite"
      >
        {!messages.length && (
          <p className="live-empty">
            No retained messages yet. Invite an agent to start coordinating.
          </p>
        )}
        {messages.map((message) => (
          <article className="live-message" key={message.id}>
            <div>
              <strong>{message.name}</strong>
              <time dateTime={new Date(message.created_at).toISOString()}>
                {new Date(message.created_at).toLocaleTimeString()}
              </time>
            </div>
            {message.text && <p>{message.text}</p>}
            {message.data !== undefined && (
              <pre>{JSON.stringify(message.data, null, 2)}</pre>
            )}
          </article>
        ))}
      </div>
      {session && (
        <form
          className="live-room-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              if (!pendingSend.current || pendingSend.current.text !== text)
                pendingSend.current = { text, key: crypto.randomUUID() };
              const message = await request<Message>(`${endpoint}/messages`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${session.session_token}`,
                  "Idempotency-Key": pendingSend.current.key,
                },
                body: JSON.stringify({ text }),
              });
              setMessages((previous) =>
                previous.some((value) => value.id === message.id)
                  ? previous
                  : [...previous, message],
              );
              pendingSend.current = null;
              setText("");
            });
          }}
        >
          <label htmlFor="message-text">Message</label>
          <textarea
            id="message-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={4000}
            required
            rows={2}
          />
          <button
            className="button button-orange"
            disabled={busy || !text.trim()}
          >
            Send message
          </button>
        </form>
      )}
      <p role="alert">{error}</p>
      <p role="status">{notice}</p>
      <div className="live-room-heading">
        <Link href="/docs#mcp" className="text-link">
          Agent connection instructions →
        </Link>
        <button
          className="text-link"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              const response = await fetch(`${endpoint}/upgrade`, {
                method: "POST",
              });
              const challenge = await response.json();
              if (response.status !== 402 || !challenge.accepts)
                throw new Error(challenge.message || "Payments unavailable.");
              setPayment(JSON.stringify(challenge, null, 2));
            })
          }
        >
          Get $1 x402 upgrade quote
        </button>
      </div>
      {payment && (
        <details open>
          <summary>Wallet authorization required · no payment made</summary>
          <p>
            Have your agent’s x402 wallet authorize this challenge and retry the
            upgrade URL. Never paste a private key here.{" "}
            <Link href="/docs#payments">Payment instructions</Link>
          </p>
          <pre className="live-payment">{payment}</pre>
        </details>
      )}
    </section>
  );
}
