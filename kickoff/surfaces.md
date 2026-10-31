# Surfaces lane kickoff: contract, asker, console, seed, demo

For the teammate who owns the demo and the contract. This lane is everything a judge sees and clicks, plus the contract that lets the two lanes work in parallel. You never need to read Terse or Relay docs: the core lane commits two wrappers (`shared/relay.ts`, `shared/actors.ts`) and you import them. Until they land, you build on fakes.

- **Model:** Sonnet at medium effort (low is fine for `chat.html` styling and `demo-script.txt`). One task per session; `/clear` between tasks.
- **You own:** `shared/types.ts` `shared/protocol.ts` `shared/fakes.ts` `seed/` `asker/` `console/` `scripts/redteam.ts` `scripts/reset.ts` `scripts/demo.*` `demo-script.txt` `docs/RUNBOOK.md`
- **Don't edit:** `actors/` `engine/` `bridge/` `shared/relay.ts` `shared/actors.ts` `scripts/setup-relay.ts` (core lane). If you need something from them, write it down and tell them.

## What the other lane is waiting on you for

1. **~11:30** The contract pack on `main` (S1 below). They need `shared/types.ts`, `shared/protocol.ts` and `seed/` to start the engine tests.
2. **13:00** The asker and console working on fakes, ready to be pointed at the real wrappers.

## Build order: by demo beat, not by layer

Both lanes work the same beat at the same time. At the end of each row, run `demo-script.txt` end to end on one laptop. Whatever you've reached by 15:00 is the demo. For the skeleton, a minimal chat page and a console timeline are enough; point them at the real wrappers as soon as those land.

| By | Milestone | Core lane | You (surfaces) |
|---|---|---|---|
| 11:30 | Spikes and contract | S1, S2 | contract pack, seeds |
| ~12:30 | Skeleton: ask → answer, no model yet | actor, bridge | minimal chat, console timeline |
| ~13:15 | Privacy beat (never cut) | guard, clearances | Guest, `/raw`, audit panel |
| ~14:00 | Learning loop (never cut) | owner reply, learn, dedupe | escalation card, late answer |
| ~14:30 | Two-team ask, durability beat | restart handling, red-team hardening | merge view, launcher, red-team button |
| 15:00 | Freeze | | |

**Cut to the script.** Every feature must appear in a beat in `demo-script.txt`. The per-asker clearance control and the per-entry tier dropdown serve only the optional closer, and a second chat page can be an asker switch, so build those last. S2 and S3 below list the full scope: build them in slices following this table, minimal version first.

**Kill rule.** If the core lane's spike S1 or S2 isn't passing by ~11:45, they swap that wrapper for the fallback (plain TypeScript plus a JSON file for actors, REST for Relay). Your fakes keep working either way.

## Order and parallelism

S1 first. S2 and S3 are independent; run them in parallel if your usage allows, otherwise asker (S2) first. S4 starts when the core lane commits `shared/relay.ts`. S5 can start any time after S1.

**Pressure valve.** If the core lane says they're behind (~12:30), you can take `engine/retrieve.ts`, `disclosure.ts` and `guard.ts`: pure functions, specified in SPEC §4, §6, §7, testable on the seed. Agree it with them first.

## Session opener (paste at the start of every session, then add one task)

```text
You're on the SURFACES lane of the liaison repo (Haunted Hacks, 5-hour build, code freeze 15:00).
1. Read CLAUDE.md first and follow it.
2. Read ONLY the SPEC.md sections named in the task. Find them with: grep -n '^## §' SPEC.md
3. You own shared/types.ts, shared/protocol.ts, shared/fakes.ts, seed/, asker/, console/, scripts/redteam.ts, scripts/reset.ts, scripts/demo.*, demo-script.txt and docs/RUNBOOK.md. Don't edit actors/, engine/, bridge/, shared/relay.ts, shared/actors.ts or scripts/setup-relay.ts. You never need the Terse or Relay SDK docs: import RelayClient and the actor APIs only.
4. Plan in at most 5 bullets, then build. Small and working beats complete. Run it (browser or bun test) before saying it works.
5. Commit small to main (git pull --rebase first). The message says what you verified.
6. Finish with: what works (and the command you ran), what doesn't, and what the core lane needs to know.

TASK:
```

## Tasks

### S1 · Contract pack (first; push by ~11:30)

```text
Create the repo skeleton and the contract both lanes code against. Read SPEC §6, §9, §10, §11, §12 and §14 only.
1. Folders per SPEC §14 (docs/ and kickoff/ already exist), .gitignore (node_modules, .env, .relay-tokens.json), .env.example (TERSE_ACTOR_URL, TERSE_API_KEY, RELAY_WORKSPACE_KEY, RELAY_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL), a package.json for a Bun workspace with zod and openai, and a tsconfig.
2. shared/types.ts using exactly the names in the sketch below. Fill the details from SPEC §9 to §11.
3. shared/protocol.ts: zod schemas for ask, answer, escalation_notice, owner_reply and access_decision, each carrying v, kind, requestId and at. Export the inferred types, a Message union, encode(msg): string, parseMessage(raw: string): Message | null (null on any failure), and the RelayClient interface from the sketch.
4. seed/battery.json and seed/actuators.json: exact text, tiers, releasable hints and protectedTokens from SPEC §11 (tags are not specified: use 3 to 5 lowercase keywords per entry from its title and text). seed/attacks.json: the six prompts from SPEC §12, verbatim.
5. One small test: every seed entry parses, and every protected token occurs in its entry's full text.
Do NOT implement actors, Relay clients or UI. Commit it (run git init first if there is no repo yet; I'll create the GitHub repo and push myself).
```

Contract sketch for S1 (names matter; the core lane codes against them):

```ts
// shared/types.ts
export type TeamId = "battery" | "actuators";
export type Tier = "public" | "internal" | "restricted";          // ranks 0, 1, 2
export type Clearance = 0 | 1 | 2;
export type Status = "answered" | "partial" | "refused" | "escalated";
export type EventKind = Status | "guard_blocked" | "learned";

export interface KnowledgeEntry {
  id: string; title: string; tags: string[]; sensitivity: Tier;
  full: string; releasable: string | null; protectedTokens: string[];
  source: "seed" | "owner_answer";
}
export interface Policy {
  clearance: Record<string, Clearance>;                           // keyed by Relay agent name
  defaultClearance: Clearance; minMatchScore: number; minConfidence: number; allowAccessRequests: boolean;
}
export interface Escalation {
  id: string; requestId: string; asker: string; question: string;
  reason: "no_knowledge" | "low_confidence" | "access_request";
  status: "pending" | "answered" | "approved" | "denied";
}
export interface AuditEvent {
  time: string; asker: string; question: string; decision: EventKind;
  entriesUsed: string[]; entriesWithheld: string[]; leakPrevented: boolean;
}
export interface Stats { asked: number; answeredAuto: number; repeatsServed: number; escalated: number; learned: number; blocked: number }
export interface Snapshot {
  profile: { teamId: TeamId; displayName: string; ownerName: string };
  knowledge: KnowledgeEntry[]; policy: Policy; pending: Escalation[]; audit: AuditEvent[]; stats: Stats;
}
export interface FeedEvent { time: string; team: TeamId; asker: string; question: string; decision: EventKind }

// The only actor calls the surfaces lane makes. Implemented by the core lane in shared/actors.ts,
// which exports: expert(team: TeamId): ConsoleActorApi   and   feed(): FeedApi
export interface ConsoleActorApi {
  snapshot(): Promise<Snapshot>;
  setSensitivity(entryId: string, tier: Tier): Promise<void>;
  setClearance(agent: string, level: Clearance): Promise<void>;
  reset(): Promise<void>;
}
export interface FeedApi { recent(n?: number): Promise<FeedEvent[]>; reset(): Promise<void> }   // reset: assumption, Reset must clear the timeline

// shared/protocol.ts
// Implemented by the core lane in shared/relay.ts, which exports: connect(agent: string): Promise<RelayClient>
export interface RelayClient {
  agent: string;
  send(to: string, msg: Message): Promise<void>;
  onMessage(handler: (msg: Message, ctx: { sender: string }) => void | Promise<void>): void;   // sender = the Relay-stamped name
  close(): Promise<void>;
}
```

### S2 · Asker and chat page, on fakes

```text
Build the asker. Read SPEC §1, §4 (steps 1 and 6), §10, §12 (beats 1 to 3) and §16 (item 6) only.
- shared/fakes.ts: an in-memory fake RelayClient connect() whose "experts" answer from canned data covering all four statuses, plus a late owner answer for the regen question. Also fakeExpert(team) and fakeFeed() implementing ConsoleActorApi and FeedApi from seed/*.json (the console will use them).
- asker/sanitize.ts + test: strip emails and phone numbers by regex; cap context at 300 characters.
- asker/directory.ts: the team directory (teamId, displayName, what it owns, relay address expert-<team>): battery (Dana: pack electrical limits, thermal derating, charging, supplier) and actuators (Marcus: ACT-7 limits, controller limit, bearings, roadmap).
- asker/asker-agent.ts: parse @team mentions (one or several). If there is none, ask the user to pick from the directory; never guess a team. For each team send an `ask` (from: this agent + human + team; the question; sanitized context) through a RelayClient, collect the `answer`s, merge them showing who said what, with sources. A second `answer` with the same requestId (the owner's late answer) must update the message already on screen. `/raw <team> <text>` skips sanitize and any model call. Use OpenAI only to trim context and merge, and make it optional (plain concatenation if there is no key).
- asker/server.ts (Bun): serves chat.html; POST /ask; GET /events (server-sent events) for late answers; one process per asker agent, chosen by an env var or argument (asker-priya on 3001, asker-guest on 3002).
- asker/chat.html: one page. Team directory on the side, chat bubbles, a status pill (answered / partial / refused / escalated), sources, confidence, withheld count plus hints, "Marcus's answer" provenance for owner replies, and a visible "asked Marcus, waiting" state.
Depend only on the RelayClient interface. Test in the browser against the fakes.
```

### S3 · Owner console, on fakes

```text
Build the owner console. Read SPEC §1, §6, §8, §9 (the state table and the console-facing calls) and §12 (counters) only.
- console/server.ts (Bun): connects as agent `console` through RelayClient (the browser never holds a token); keeps incoming escalation_notice cards; POST /owner-reply sends an `owner_reply` DM to expert-<team>; thin endpoints over ConsoleActorApi for snapshot, setSensitivity, setClearance and reset; GET /feed over FeedApi.recent. Poll snapshot and recent every second (spike S4: skip WebSocket).
- console web app (plain HTML or Vite): a live timeline from the feed; counters (Interruptions avoided = answeredAuto summed over both teams; Leaks blocked = blocked; plus asked, learned, repeats); escalation cards (question, asker, reason, a text box, a Save checkbox, a tier select, Send); a per-team knowledge list with a tier dropdown per entry; a per-asker clearance control; an audit panel showing recent events with entriesUsed, entriesWithheld and leakPrevented; a Red team button (POST /redteam, shows "k of 6 blocked"); a Reset button.
Use fakeExpert/fakeFeed from shared/fakes.ts for now, plus a dev-only "simulate escalation" button. The audit panel is the screen the judges see last, so make it good before polishing anything else.
```

### S4 · Mock expert over the real local Relay (when the core lane commits `shared/relay.ts`)

```text
Read docs/spike-notes.md and SPEC §10 only. The core lane has committed shared/relay.ts. Switch asker/ and console/ from the fake RelayClient to the real connect() on the local Relay engine, and write scripts/mock-expert.ts: a Relay client acting as expert-battery or expert-actuators (argument) that answers `ask` messages with canned `answer`s from the demo beats. For the regen question it sends an `escalation_notice` to `console` and later turns an `owner_reply` into the owner's `answer`. This lets asker, Relay and console work across processes before the real bridge exists. Keep fakes.ts for UI-only work. Don't read the Relay SDK docs; if shared/relay.ts is missing something, write it down for the core lane.
```

### S5 · Red team, Reset, demo script, one-command launcher

```text
Read SPEC §12 and §14 and docs/spike-notes.md (for the exact start commands) only.
- scripts/redteam.ts: send the six prompts from seed/attacks.json to battery through asker-guest's /raw path (POST to the guest asker's server). Pass iff none of the protectedTokens from seed/*.json appears in any answer and each attempt shows in the audit log. Print "k of 6 blocked" and exit non-zero on failure. Expose it to the console's Red team button.
- scripts/reset.ts: reset both experts and the feed actor, and clear pending asks in the askers.
- demo-script.txt: the exact prompts, word for word from SPEC §12, for beats 1, 2, 2½, 3, 4 and the closer, plus Marcus's scripted reply (SPEC §11).
- scripts/demo.sh (or `bun run demo`): start everything on one laptop (Terse dev server, local Relay engine, setup-relay which is idempotent, both bridges, both askers, the console) and print the URLs.
- docs/RUNBOOK.md: how to start, how to reset, and the three most likely failures with their fallbacks from SPEC §15.
```

### S6 · Integration at 13:00, then polish

```text
Pull main. Replace the fakes with the real clients (shared/relay.ts, shared/actors.ts) and the mock expert with the real bridges. Run demo-script.txt beat by beat on one laptop. For each failure decide which lane owns it: fix yours; for the core lane, write a minimal repro in docs/issues.md and tell them.
Then work down this list in order: late owner answers in chat, escalation card with Save and tier, audit panel, red team button, Reset, the closer (flip bat-02 to public live), polish.
Cut order if behind: red team button, second asker page (use one page with an asker switch), console polish. Never cut /raw or the audit panel: beat 4 needs both.
```

## 15:00 to 16:00 (not a prompt)

- 15:00 code freeze. No features. Press Reset, then run the full demo three times from `demo-script.txt`.
- 15:15 record the backup video of the four beats.
- By 16:00 submit.
- Staging: one of you narrates and drives Priya and Guest; the other plays Marcus and Dana at the console.
