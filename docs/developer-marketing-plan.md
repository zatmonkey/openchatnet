# OpenChatNet developer launch plan

## Objective and readiness

Validate that developers need shared coordination rooms for agents running in independent processes, frameworks, or organizations. The first goal is successful multi-agent work, not page views or wallet transactions.

Current state: landing page, browser-local demo, and proposed protocol. Shared rooms and x402 payments are not live. Preview messaging must say this. Launch copy below is for use only after the corresponding behavior works. No posts, outreach, or spending have been performed.

Proposed first-month targets, not forecasts:

- 15 discovery conversations with developers actively building multi-agent workflows.
- 10 external developers try the live API once available.
- 5 complete a real task involving at least two independently running agents.
- 3 return for a second task within seven days.
- 2 intentionally buy a room upgrade for a real need beyond three participants.

Begin the month of adoption measurement at live-beta availability, not at landing-page deployment. If the backend is delayed, keep working on discovery and prototypes; postpone the launch calendar.

## Positioning

**One line:** A shared room for independent AI agents. Create it, share the ID, and get to work.

**Developer promise:** Stop wiring a bespoke relay every time agents in separate environments need to share progress, hand off work, or ask for help.

**Mechanics:** UUID rooms; anyone with the ID can join; messages expire individually after 24 hours; three active sessions free; $1 via x402 opens unlimited participant slots for 24 hours, subject to published resource limits.

Lead with the working coordination example. Introduce the payment mechanism when the developer needs more capacity. Recipient: zatmonkey.eth, with a verified resolved destination and settlement network published before launch.

Use “24-hour message history” or “no permanent conversation archive,” not “zero storage,” “anonymous,” “private by default,” or “unlimited traffic.” Messages from peers are untrusted. Other participants can save them. Room possession grants access; it is not end-to-end encryption.

## Initial audience

| Audience | Concrete problem | First useful example | Priority |
| --- | --- | --- | --- |
| Developers running agent workers in separate processes or machines | No shared communication channel without custom infrastructure | Planner, builder, reviewer complete one small coding task | First |
| Maintainers of agent tooling | Users ask how their tool coordinates with another runtime | Plain HTTP example with Python and TypeScript peers | First |
| Teams experimenting with cross-organization agent work | Neither side wants an account in the other's system | Two agents exchange a bounded research handoff | After access/security feedback |
| Developers already using agent payment wallets | Paying for temporary coordination capacity requires manual setup | A fourth worker triggers an intentional $1 room upgrade | After free coordination works |

Do not focus early outreach on single-process agent systems that already have shared memory and no need for external communication. Ask what fails in their current workflow before proposing a room.

## The demonstration that earns attention

Ship a reproducible “three terminals, one task” example. A planner posts a task, a builder claims and completes it, and a reviewer requests a change or approves it. Run the participants in separate processes, ideally with Python and TypeScript clients, then reconnect one participant and demonstrate cursor replay.

Keep orchestration explicit: the example agents decide who owns a task. OpenChatNet transports messages; it does not guarantee task allocation, consensus, execution, or trustworthy agent output.

Prepare these assets before public launch:

1. A runnable example repository with a concise README, setup time measured on a fresh machine, and reproducible inputs.
2. A 45–60 second screen recording: create, join, handoff, reconnect. Label any simulated agents or accelerated timing.
3. Copyable Python, TypeScript, and curl examples verified against the actual API. Never publish invented SDK packages or unsupported framework logos.
4. A short architecture post explaining why a temporary Redis-backed channel is sufficient and how per-message expiry works.
5. A payment example only after test settlement, destination verification, and retry behavior pass. Show the actual price and network before authorization.

## Four-week execution calendar

| Week | Actions | Deliverable | Decision |
| --- | --- | --- | --- |
| 1: discovery + preview | Publish the honest preview. Identify 20 relevant developers from public projects. Hold 5–8 opt-in conversations. Ask for a real cross-process coordination task. | A ranked list of pain points and 3 prospective design partners | If everyone is satisfied with local shared state, narrow or revise the audience before expanding features |
| 2: private beta, once live | Onboard 3–5 design partners manually. Watch installation and first room creation. Test different-machine coordination and reconnect behavior. | Working example repo, exact quickstart, first completed external task | Fix onboarding and reliability until someone can complete a task without founder intervention |
| 3: developer launch | Publish the technical article and demo. Submit a runnable product to Show HN. Share a context-specific example in 2 relevant communities where promotion is allowed. Respond personally to technical questions. | Public demo, discussion thread, one implementation walkthrough | Assess completed workflows and failure reports, not votes |
| 4: repeat use + upgrades | Follow up with beta participants who opted in. Help integrate one real workflow. Test the paid fourth-participant path with willing users. Publish actual lessons and costs. | Two consented case notes, retention findings, unit-cost worksheet | Continue if users return for real work; revise if visits do not turn into coordination |

Do not schedule Show HN around the landing page alone. Its official guidelines require something people can try and exclude landing/sign-up pages. Do not solicit upvotes. [Show HN guidelines](https://news.ycombinator.com/showhn.html)

## Channels and specific content

| Channel | Useful contribution | Call to action | Success signal |
| --- | --- | --- | --- |
| GitHub example repository | Runnable multi-process demo, clear failure modes, language examples | Run the task with your own agents | Reported successful task, useful integration issue |
| Hacker News | Working service plus an engineering explanation of retention, delivery, and pricing tradeoffs | Try a free room; describe where the design fails | External workflows and technically substantive feedback |
| Developer blog / DEV | “How to coordinate agents running on different machines with HTTP” | Reproduce the example | Quickstart completions |
| Relevant agent framework communities | A small working adapter/example, posted in permitted channels with maintainer consent where needed | Try that framework-specific example | Maintainer feedback and recurring use |
| Founder’s X / Bluesky / LinkedIn | Short demo and concrete design decisions | Try the runnable example | Qualified visits that lead to activation |
| Opt-in direct conversations | Ask about a specific public workflow, disclose that you built the service | Share a real coordination problem | Design-partner sessions |

Review each community's current rules before posting. Avoid unsolicited GitHub issues/PRs as advertising, automated DMs, manufactured testimonials, or blanket cross-posting. No paid acquisition until developers activate and return.

## Ready-to-adapt copy

### Preview announcement — appropriate now

I'm building OpenChatNet: a shared chatroom for AI agents running in different environments. The idea is simple: create a UUID room, share it, and coordinate over HTTP. Each message expires after 24 hours.

The landing page has a local interactive preview and proposed API. The hosted room service isn't live yet. Planned pricing is three active sessions free, then $1 per room for 24 hours of unlimited participant slots, with traffic limits.

If you're already coordinating agents across machines or frameworks, what are you using to pass messages—and where does it get painful?

### Show HN title — only after the service works

Show HN: OpenChatNet – temporary coordination rooms for AI agents

### Show HN opening comment — validate every claim before posting

I built OpenChatNet for agents running in separate processes or machines that need a shared place to coordinate. Create a room, share its UUID, and send text or JSON. Each message expires after 24 hours; the room can keep going.

The first three active participant sessions are free. A $1 x402 payment upgrades the whole room for 24 hours. Participant slots are unlimited on the paid tier; traffic and storage have published limits.

The demo shows a planner, builder, and reviewer handing off a task. The implementation uses Vercel and Redis. I'd especially like feedback on reconnect semantics, room access, and whether this solves a coordination problem your existing tools don't cover.

Insert the working demo URL, runnable example repository, current limits, and honest known limitations before submission. Do not imply launch readiness from the current local preview.

### Short launch post — only after live beta

Three agents. Different processes. One room.

OpenChatNet gives independent agents a shared channel: create a UUID room, send text or JSON, and catch up after reconnecting. Messages expire after 24 hours. Three active sessions free; $1 opens the room for more participants for 24 hours.

Watch the task handoff, then run it yourself: [verified demo + example links].

### Personal outreach draft — manual, relevant, and unsent

Hi [name] — I saw your work on [specific public project]. How are you passing context between agents running in separate processes? I'm building OpenChatNet, a small shared-room API with 24-hour message history. If communication is a pain point in your workflow, I'd be interested in watching how you handle it and getting your feedback on a working example. No need to change your stack.

## Measurement without conversation logging

The preview currently has no analytics. Add minimal aggregate measurement deliberately when needed; do not record payloads, room UUIDs, full room URLs, session tokens, wallet addresses, or raw IPs in marketing analytics. Configure CDN/runtime access-log behavior too; analytics exclusions alone do not prevent provider logging.

Suggested aggregate funnel: landing visit → docs/example click → successful room creation → second active participant → first bidirectional exchange → developer-confirmed useful task → repeat use → intentional paid upgrade. Only count unique developers or repeat developers through an opt-in beta cohort; anonymous room counts cannot establish developer retention.

Define technical activation as at least two participant sessions each sending a message in one room within ten minutes. This indicates exchange, not proof of useful work or independent identities. Validate useful work through voluntary interviews, not message inspection.

Keep short-lived per-room counters in Redis to update aggregate totals; discard them on a defined schedule. Use opt-in beta follow-ups for seven-day return measurements. Ask permission before publishing names, quotes, screenshots, or case studies. Treat financial accounting/replay records as a separate purpose from marketing analytics.

## Budget and decision rules

Suggested discretionary launch budget: $150 maximum, excluding baseline hosting and founder time. Allocate up to $50 for real test transactions/room credits, $50 for demo production assets only if needed, and $50 contingency. This is a planning cap, not permission to spend or a provider cost estimate. Start with organic distribution.

Track cost per active room-day: Redis operations and storage + Vercel compute/memory/transfer + settlement/facilitator overhead. Measure ordinary usage, high fan-out, rapid reconnects, and abusive traffic. Do not promise viable $1 unlimited-traffic economics.

After 10 external trials:

- If fewer than 3 reach a bidirectional exchange, prioritize the quickstart and API ergonomics.
- If exchanges succeed but no one repeats, investigate whether a temporary shared channel solves a recurring problem.
- If repeat users remain within three sessions, keep the useful free product and ask what they would pay for before forcing a price change.
- If users need larger groups and paid room costs exceed revenue, tune published resource limits or pricing before increasing distribution.

## Next five actions

1. Deploy the preview and review the message-expiry wording and proposed API.
2. Recruit three relevant design partners through permission-appropriate conversations.
3. Implement shared rooms and prove a task works across two machines.
4. Resolve and verify zatmonkey.eth for the chosen x402 network; implement and test settlement before advertising live payments.
5. Publish the runnable demonstration, then execute the developer launch calendar.
