import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const origin = process.argv[2] || "http://localhost:3000";
const jsonHeaders = { "Content-Type": "application/json" };
const created = await fetch(`${origin}/api/rooms`, { method: "POST" });
assert.equal(created.status, 201, await created.clone().text());
assert.match(created.headers.get("cache-control"), /no-store/);
const room = await created.json();
const path = `${origin}/api/rooms/${room.room_id}`;
const sessions = [];
for (let index = 0; index < 3; index++) {
  const response = await fetch(`${path}/join`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ name: `smoke-${index}` }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  sessions.push(await response.json());
}
assert.equal(
  (
    await fetch(`${path}/join`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "fourth" }),
    })
  ).status,
  409,
);
const options = {
  method: "POST",
  headers: {
    ...jsonHeaders,
    Authorization: `Bearer ${sessions[0].session_token}`,
    "Idempotency-Key": randomUUID(),
  },
  body: JSON.stringify({
    text: "OpenChatNet deployment smoke test; expires after 24h.",
    data: { tasks: [], test: true },
  }),
};
const sent = await fetch(`${path}/messages`, options);
assert.equal(sent.status, 201, await sent.clone().text());
const message = await sent.json();
const repeated = await (await fetch(`${path}/messages`, options)).json();
assert.equal(repeated.id, message.id);
const history = await (await fetch(`${path}/messages`)).json();
assert.equal(history.messages.length, 1);
assert.deepEqual(history.messages[0].data.tasks, []);

const abort = new AbortController();
const stream = await fetch(`${path}/events`, { signal: abort.signal });
assert.equal(stream.status, 200);
assert.match(stream.headers.get("content-type"), /text\/event-stream/);
const reader = stream.body.getReader();
let received = "";
while (!received.includes(message.id)) {
  const { value, done } = await reader.read();
  if (done) break;
  received += new TextDecoder().decode(value);
}
assert.ok(received.includes(`id: ${message.id}`));
abort.abort();

const quote = await fetch(`${path}/upgrade`, { method: "POST" });
assert.equal(quote.status, 402, await quote.clone().text());
assert.ok(quote.headers.get("payment-required"));
const challenge = await quote.json();
assert.equal(challenge.accepts[0].amount, "1000000");
assert.equal(challenge.accepts[0].network, "eip155:8453");
assert.equal(
  (
    await fetch(`${path}/upgrade`, {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": "invalid" },
    })
  ).status,
  400,
);
assert.equal(
  (
    await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { ...jsonHeaders, Origin: "https://evil.invalid" },
      body: "{}",
    })
  ).status,
  403,
);

const client = new Client({ name: "openchatnet-smoke", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)),
);
const listed = await client.listTools();
assert.equal(listed.tools.length, 9);
const tools = new Set(listed.tools.map((tool) => tool.name));
for (const name of [
  "create_room",
  "join_room",
  "send_message",
  "read_messages",
  "wait_for_messages",
  "leave_room",
  "upgrade_room",
])
  assert.ok(tools.has(name));
const read = await client.callTool({
  name: "read_messages",
  arguments: { room_id: room.room_id },
});
assert.equal(read.isError, undefined);
assert.equal(read.structuredContent.messages[0].id, message.id);
const paid = await client.callTool({
  name: "upgrade_room",
  arguments: { room_id: room.room_id },
});
assert.equal(paid.structuredContent.status, 402);
await client.close();

const modern = new Client(
  { name: "openchatnet-modern-smoke", version: "1.0.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
await modern.connect(
  new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)),
);
assert.equal((await modern.listTools()).tools.length, 9);
const modernRead = await modern.callTool({
  name: "read_messages",
  arguments: { room_id: room.room_id },
});
assert.equal(modernRead.structuredContent.messages[0].id, message.id);
await modern.close();

for (const session of sessions)
  assert.equal(
    (
      await fetch(`${path}/leave`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.session_token}` },
      })
    ).status,
    200,
  );
console.log(
  "PASS: HTTP, shared Redis, atomic admission, idempotency, JSON, SSE, MCP tools, x402 challenge, invalid-payment rejection, and origin protection. No funds spent.",
);
