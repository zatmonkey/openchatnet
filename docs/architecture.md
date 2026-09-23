# OpenChatNet implementation brief

Status: proposed backend, not yet implemented. The landing page and protocol preview are implemented.

## Product contract

- Random UUID v4 room IDs; anyone possessing the ID can join. No public directory initially.
- Messages expire individually exactly 24 hours after their server-assigned creation time. Activity and payment never reset message age.
- Rooms are not automatically deleted at their 24-hour birthday. Inactive, empty rooms can later be collected under a separately published policy.
- Three active participant sessions are free. Heartbeat leases determine occupancy; display names do not establish identity.
- $1 upgrades a room to unlimited participant slots for the following 24 hours. Message, throughput, storage, and resource limits still apply and must be published before launch.
- No automatic payment renewal. One payer upgrades access for the whole room.

## Storage and transport

Use Next.js route handlers on Vercel plus Upstash Redis as the only shared data store. Keep authoritative state outside function memory. Run compute near the Redis primary for atomic writes and session admission. Use POST requests for writes and SSE for live events; clients reconnect before function timeouts and resume with a cursor.

Suggested keys:

| Key | Purpose | Retention |
| --- | --- | --- |
| `room:{uuid}:meta` | Creation time, paid-until timestamp | Room lifecycle, independent of messages |
| `room:{uuid}:messages` | Stream of message IDs, server timestamps, payloads | Age-based trimming, not activity-based TTL |
| `room:{uuid}:presence` | Sorted set of session IDs and lease expiration | Prune expired leases on access |
| `room:{uuid}:session:{id}` | Hash of session token and participant label | Short renewable lease |
| `room:{uuid}:dedupe:{key}` | Message idempotency result | Bounded retry window |
| `payment:{network}:{receipt}` | Settlement state, room, upgrade application | Payment/replay retention policy; no message bodies |

Streams provide replayable ordered events. Each participant receives every relevant room message; a Redis consumer group that divides messages between participants is not the room's broadcast delivery mechanism. Define pagination, maximum payload size, backlog limits, and rate limits before exposing creation endpoints.

## Enforcing message expiration

1. Assign creation and expiration using trusted server time. Never allow client timestamps to extend retention.
2. Filter expired messages on all reads, replay, and delivery paths; do not depend on the sweeper having run.
3. Trim each stream by age on writes/reads and use a scheduled sweeper for idle rooms. Use exact age trimming supported by the chosen Redis provider, not approximate trimming alone for a hard retention boundary.
4. Set a stream TTL as an idle-storage backstop. A refreshed 24-hour stream TTL alone leaves older entries in active rooms and is insufficient.
5. If a replay cursor predates retained history, report a history gap. Give consumers stable IDs and recommend deduplication; do not promise end-to-end exactly-once effects.
6. Verify provider persistence and backup settings. State API visibility guarantees separately from physical deletion and backup retention until those are validated. Never log message bodies in runtime logs, traces, or analytics.

Verify behavior at the 24-hour boundary, in continuously active rooms, after idle periods, and on reconnect. Purchasing another day must never retain expired messages.

## Admission and presence

Use an atomic operation to remove expired leases, check current capacity, and admit a session. Otherwise simultaneous joins can exceed the three-session cap. A heartbeat renews a lease only for a valid session token. Resume the same session on reconnect and make session creation retries idempotent.

Suggested starting lease: 90 seconds with a 30-second heartbeat. These are proposed defaults, not live guarantees. Abuse limits apply to both paid and free rooms. Unauthenticated creation must be rate limited.

On paid expiry, offer a documented grace behavior: existing participants can read retained history, but only three sessions retain sending privileges under a deterministic admission rule. Notify all affected clients. Finalize the rule before shipping; do not disconnect paying workflows without an explicit expiry event.

## x402 recipient and settlement

User-specified recipient: **zatmonkey.eth**.

Resolve ENS with a trusted Ethereum resolver, independently verify the returned destination and selected settlement network, and pin the result in `X402_PAY_TO_ADDRESS`. Keep `X402_PAY_TO_ENS=zatmonkey.eth` as the human-readable source. Do not resolve on each payment, silently change recipients, or accept a null/zero address. Network, stablecoin contract/decimals, facilitator, and destination must be explicitly configured before checkout can run. Fail closed when configuration is missing.

The upgrade route offers a $1 room entitlement via x402, using a supported network/asset pair. Record a server-generated purchase ID bound to room, price, network, recipient, and payer authorization. Confirm successful settlement before granting access. Atomically persist the receipt and update `paid_until`; retrying an already settled purchase returns the same result rather than billing again. A new intentional purchase extends `max(now, paid_until)` by 24 hours.

Plan for crashes between on-chain settlement and Redis writes: reconcile by purchase/transaction identifier, and never treat a response timeout as proof of nonpayment. Preserve receipt uniqueness for at least the full authorization/replay window. Keep Redis durable and avoid eviction of paid entitlements and replay records. Chat retention does not apply to financial records; disclose public chain records separately.

## Before production

- Implement the API contract and validate all input, room access, session tokens, and payload limits.
- Verify room isolation, concurrent admission, retry deduplication, and reconnect gaps.
- Verify per-message expiry for active and idle rooms, independent of paid access.
- Verify payment destination and wrong-network, duplicate-payment, timeout, and settlement-recovery cases.
- Load-test fan-out and reconnect behavior. Measure Redis commands, memory, Vercel compute/transfer, and settlement overhead per paid room-day before validating $1 economics.
- Publish concrete rate limits, retention wording, paid-expiry behavior, and supported payment network.

## Primary references

- [Vercel Redis integrations](https://vercel.com/docs/redis)
- [Upstash Realtime deployment and reconnection](https://upstash.com/docs/realtime/features/serverless)
- [Redis key expiration](https://redis.io/docs/latest/commands/expire/)
- [x402 protocol and implementation](https://github.com/x402-foundation/x402)

References reviewed September 23, 2026. Recheck SDK and provider support when implementing the backend.
