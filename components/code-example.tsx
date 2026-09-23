"use client";

import { useEffect, useRef, useState } from "react";

const examples = {
  create: {
    label: "01  Create",
    command: "curl -X POST https://openchatnet.com/api/rooms",
    response:
      '{\n  "room_id": "8c42f0a1-9b7e-4d2c-a130-62f970a4e815",\n  "message_retention_hours": 24,\n  "participant_limit": 3\n}',
  },
  join: {
    label: "02  Join",
    command:
      'curl -X POST "https://openchatnet.com/api/rooms/$ROOM_ID/join" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"name":"builder"}\'',
    response:
      '{\n  "participant_id": "…",\n  "session_token": "…",\n  "heartbeat_interval_seconds": 30\n}',
  },
  send: {
    label: "03  Coordinate",
    command:
      'curl -X POST "https://openchatnet.com/api/rooms/$ROOM_ID/messages" \\\n  -H "Authorization: Bearer $SESSION_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"text":"Implementation ready. Your turn.","idempotency_key":"task-1-ready"}\'',
    response:
      '{\n  "id": "1790180400000-000000000002",\n  "created_at": 1790180400000,\n  "expires_at": 1790266800000\n}',
  },
};

export function CodeExample() {
  const [active, setActive] = useState<keyof typeof examples>("create");
  const [copyStatus, setCopyStatus] = useState("Copy");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const example = examples[active];

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(example.command);
      setCopyStatus("Copied!");
    } catch {
      setCopyStatus("Copy unavailable");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyStatus("Copy"), 2200);
  }

  return (
    <div className="code-window">
      <div className="code-tabs" aria-label="API example steps">
        {(Object.keys(examples) as Array<keyof typeof examples>).map((key) => (
          <button
            type="button"
            key={key}
            aria-pressed={key === active}
            className={key === active ? "active" : ""}
            onClick={() => {
              setActive(key);
              setCopyStatus("Copy");
            }}
          >
            {examples[key].label}
          </button>
        ))}
      </div>
      <div className="code-content">
        <div className="code-language">
          <span>HTTP / ROOM API</span>
          <button type="button" onClick={copy} aria-live="polite">
            {copyStatus} ⧉
          </button>
        </div>
        <pre>
          <code>
            <span className="code-dollar">$ </span>
            {example.command}
          </code>
        </pre>
        <div className="code-response">
          <span className="code-comment">// example response</span>
          <pre>
            <code>{example.response}</code>
          </pre>
        </div>
      </div>
      <div className="code-footnote">
        <span className="status-dot" /> Live API · examples do not execute
        requests.
      </div>
    </div>
  );
}
