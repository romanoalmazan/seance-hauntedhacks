# liaison (Séance): Haunted Hacks, 2026-10-31

Per-team expert agents answer cross-team questions under tier/clearance rules. Restricted text lives only in the expert's Terse Durable Actor; Agent Relay carries guarded text between agents. Spec: `SPEC.md` (read only the sections your task needs; see its reading guide). Per-lane task prompts: `kickoff/core.md` and `kickoff/surfaces.md`.

## Lanes: two people, disjoint folders
- **core**: `actors/` `engine/` `bridge/` `shared/relay.ts` `shared/actors.ts` `scripts/setup-relay.ts` `docs/spike-notes.md`
- **surfaces**: `asker/` `console/` `seed/` `scripts/redteam.ts` `scripts/reset.ts` `scripts/demo.*` `demo-script.txt` `shared/fakes.ts` `docs/RUNBOOK.md`
- **contract**: `shared/types.ts` and `shared/protocol.ts`. Surfaces writes them first. After that, anyone may fix them with the smallest possible change, in its own commit straight to `main`, and must tell the other person immediately.
- Don't edit the other lane's files. If you need a change there, write it down for the other person.

## Rules that must hold
- Bun and TypeScript. **Unverified:** the playbook says Bun >= 1.4.2 and packages `terse-sdk` + `terse-cli` (and warns against mixing in the `durable-actors` import flavor), but public docs show a `durable-actors` package and Bun 1.3.9+. Spike S1 decides which family the hosted Terse platform uses and records it in `docs/spike-notes.md`. Follow that, and never mix the two families in this repo.
- Every actor field is `@Persisted` or `@Ephemeral`. **A persisted array only saves when it is reassigned. Never `push` or `splice` in place; build a new array and assign it.** (knowledge, audit and pending are all arrays.)
- A Terse actor runs one call at a time, even across an await. Any method that awaits a fetch or model call needs `@Interleave`. Actor-to-actor calls are undocumented: orchestrate from the bridge.
- **Identity is the Relay sender's agent name.** Never read who is asking from the message body. Unknown senders get the default clearance (0).
- Nothing above the asker's clearance ever reaches the model. Nothing reaches Relay unless it passed the guard. Relay carries text, never files.
- Zod-validate every incoming Relay message and drop invalid ones. Deliveries replay: the actor dedupes asks by `requestId`, but `shared/relay.ts` dedupes on the Relay delivery id (or, if the SDK exposes none, sender + kind + requestId + status + provenance), never on `requestId` alone, because an escalation's late owner answer reuses the ask's `requestId`.
- Relay: registration is create-only (a duplicate name returns 409), so save tokens in the gitignored `.relay-tokens.json` and reuse them. Subscribe; don't poll. On start and after any reconnect, drain accepted deliveries and ack each one. The website docs are stale: trust the GitHub README and the types shipped in `node_modules`. Use a local engine, not hosted. Playbook: `npx @relaycast/engine --port 8787` with `RELAY_BASE_URL=http://localhost:8787`; a public description instead mentions a local daemon at `127.0.0.1:7528`. Spike S2 records the real command and URL in `docs/spike-notes.md`. No TypeScript DM call? Use REST `POST /v1/dm` with the agent token as bearer.
- The model name comes from `OPENAI_MODEL`. Never hard-code one from memory. Expert answers stay under 120 words.
- The user names the team (`@actuators`). The agent never guesses or routes.
- Learned entries are titled with the original question and saved only when the owner ticks Save.
- Fictional company: XYZ Company. Don't use the Optimus or Semi team names.
- Keep secrets out of git: `.env`, `.relay-tokens.json`.

## Working agreement
- One task per session. `/clear` between tasks.
- Small commits straight to `main`. `git pull --rebase` before every push. The commit message says what was verified.
- Stuck on an SDK for 15 minutes? Use the fallback in SPEC §15, or stop and ask. Don't keep trying variations.
- Deadlines: spikes pass by 11:30, milestones at 13:00, **code freeze 15:00**, backup video 15:15, submit 16:00.
- Cut order if behind: red-team button, second asker, Supabase mirror, CLI-agent asker, console polish. **Never cut** the escalate-and-learn loop or the blocked-leak demo beat (beat 4).
