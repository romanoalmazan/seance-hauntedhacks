# Core lane kickoff: actors, engine, bridge, Relay

For the teammate on the Claude Max account. This lane is everything on the "documents stay home" side of the red line, plus the two thin SDK wrappers the other lane imports. Terse and Relay are young and their docs are partly stale, so expect trial and error. That is why this lane sits on the Max account.

- **Model:** your strongest, at high effort for C1, C2 and C4–C7. Medium is fine for C3.
- **You own:** `actors/` `engine/` `bridge/` `shared/relay.ts` `shared/actors.ts` `scripts/setup-relay.ts` `docs/spike-notes.md`
- **Don't edit:** `asker/` `console/` `seed/` `scripts/redteam.ts` `scripts/reset.ts` (surfaces lane). The contract (`shared/types.ts`, `shared/protocol.ts`) is theirs to write first; fix it only the way `CLAUDE.md` says.

## What the other lane is waiting on you for

1. **~11:30** Spikes S1 and S2 pass, and `docs/spike-notes.md` has the exact commands to start the Terse dev server and the local Relay engine.
2. **~12:15** `shared/relay.ts` and `shared/actors.ts` (console-facing calls) work against real actors. Until then they build on fakes.
3. **13:00** Question in, cited answer out from a terminal, for both teams. Then integrate on one laptop (everything local, nothing shared but git).

## Build order: by demo beat, not by layer

Both lanes work the same beat at the same time. At the end of each row, run `demo-script.txt` end to end on one laptop. Whatever you've reached by 15:00 is the demo. The skeleton is C4 and C5 without the model call.

| By | Milestone | You (core) | Other lane |
|---|---|---|---|
| 11:30 | Spikes and contract | S1, S2 | contract pack, seeds |
| ~12:30 | Skeleton: ask → answer, no model yet | actor, bridge | minimal chat, console timeline |
| ~13:15 | Privacy beat (never cut) | guard, clearances | Guest, `/raw`, audit panel |
| ~14:00 | Learning loop (never cut) | owner reply, learn, dedupe | escalation card, late answer |
| ~14:30 | Two-team ask, durability beat | restart handling, red-team hardening | merge view, launcher, red-team button |
| 15:00 | Freeze | | |

**Kill rule.** If S1 or S2 isn't passing by ~11:45, swap that wrapper for the fallback (plain TypeScript plus a JSON file for the actors, REST `POST /v1/dm` for Relay) and keep going. The other lane's fakes keep working either way.

## Order and parallelism

Run C1 and C2 as two sessions at once. Start C3 as soon as the contract pack is on `main` (it has no SDK dependency). C4 needs C1 and C3. C5 needs C2 and C4. C6 and C7 come after C5.

**Pressure valve.** If you're behind at ~12:30, say so. The other lane can take `engine/retrieve.ts`, `disclosure.ts` and `guard.ts` (pure functions, specified in SPEC §4, §6, §7, testable on the seed).

## Session opener (paste at the start of every session, then add one task)

```text
You're on the CORE lane of the liaison repo (Haunted Hacks, 5-hour build, code freeze 15:00).
1. Read CLAUDE.md first and follow it.
2. Read ONLY the SPEC.md sections named in the task. Find them with: grep -n '^## §' SPEC.md
3. You own actors/, engine/, bridge/, shared/relay.ts, shared/actors.ts, scripts/setup-relay.ts and docs/spike-notes.md. Don't edit asker/, console/, seed/ or the other lane's scripts. If the contract (shared/types.ts, shared/protocol.ts) is wrong or missing something, make the smallest fix in its own commit on main and tell me so I can ping the other person.
4. Plan in at most 5 bullets, then build. Tests first where the task says so. Run everything you claim works.
5. Commit small to main (git pull --rebase first). The message says what you verified.
6. Finish with: what works (and the command you ran), what doesn't, and what the other lane needs from you.

TASK:
```

## Tasks

### C1 · Spike S1: Terse (session 1, ~20 min)

```text
Spike S1, Terse Durable Actors. Read SPEC §9 and §17 (Terse list) only.
Prove the things we depend on before building anything real.
1. Check the Bun version (the playbook says >= 1.4.2; public docs say 1.3.9+). Work out which package family the hosted platform uses: the playbook says terse-sdk and terse-cli (not the durable-actors flavor), while the public README shows `durable-actors` (`npx durable-actors init`, `npx durable-actors dev`). Try the playbook's first; if it doesn't install or doesn't match api.useterse.ai, switch, and record which worked and why. Never mix the two families in this repo.
2. Make a throwaway actors/hello.ts with: a @Persisted counter; a @Persisted array (test that an in-place push does NOT survive but reassignment DOES); and a method marked @Interleave that awaits an outbound fetch.
3. Write scripts/spike-s1.ts that calls it through the SDK client against the local dev server (127.0.0.1:7100).
4. Prove: (a) values survive a dev-server restart; (b) the push-vs-reassign behavior; (c) @Interleave + fetch works, so a model call can live inside the actor; (d) call latency including a cold start (~300 ms expected); (e) how an actor reads a secret like OPENAI_API_KEY.
5. Try `terse deploy` once. Note the shape of TERSE_ACTOR_URL and where TERSE_API_KEY comes from.
6. Write what you learned to docs/spike-notes.md under "## S1": exact commands, versions, surprises, and a plain yes/no on "model call inside the actor". Don't build the real actors yet.
```

### C2 · Spike S2: Relay, plus `shared/relay.ts` (session 2, parallel with C1, ~25 min)

```text
Spike S2, Agent Relay. Read SPEC §10 and §17 (Relay list) only. The website docs are stale: trust the GitHub README and the types shipped in node_modules.
1. Start a local Relay engine. The playbook says npx @relaycast/engine --port 8787; a public description mentions a local daemon at 127.0.0.1:7528 instead, so confirm which is real. Set RELAY_BASE_URL and note the exact steps.
2. Write scripts/setup-relay.ts: create the workspace and register the five agents (expert-battery, expert-actuators, asker-priya, asker-guest, console). Save tokens to the gitignored .relay-tokens.json and reuse them on re-run (a duplicate registration returns 409).
3. Write shared/relay.ts exporting connect(agent: string): Promise<RelayClient>, where RelayClient is the interface in shared/protocol.ts (send, onMessage with a { sender } context, close). connect() loads that agent's token from .relay-tokens.json and honors RELAY_BASE_URL, so callers pass only the agent name. Inside it: subscribe (no polling); on start and on every reconnect drain accepted deliveries and ack each; dedupe by requestId; zod-validate with parseMessage and drop invalid messages. `sender` must be the Relay-stamped sender name, never anything from the body. If the SDK has no TypeScript DM method, use REST POST /v1/dm with the agent token as bearer.
4. scripts/spike-s2.ts proves: two agents DM each other; with the receiver stopped, a message sent now is delivered after it restarts and drains; a replayed delivery is handled once.
5. Write findings to docs/spike-notes.md under "## S2": exact commands, which SDK family you used, surprises.
If shared/protocol.ts isn't on main yet, stub the types locally and say so.
```

### C3 · Engine: pure functions, tests first (start when the contract pack lands, ~11:30)

```text
Build the pure engine in engine/ with tests first (bun test). Read SPEC §4 (steps 2–4), §6, §7 and §11 only. No Terse or Relay imports in this folder.
- retrieve.ts: score entries by keyword overlap with the question; keep the top 6.
- disclosure.ts: given scored entries, the asker's clearance and the policy, return { visible, hints, withheldCount, topScore }. Entries above the clearance contribute only their `releasable` hint.
- guard.ts: normalize (lowercase, strip spaces and punctuation) the answer and each protected token of every entry the asker cannot see; any hit means { ok: false }. Mind the false-positive note in SPEC §7.
- prompts.ts: the system prompt from SPEC §4 step 3 (answer only from the entries, cite entry ids, return JSON { answer, usedEntryIds, confidence, needsOwner }, under 120 words) plus: if the entries do not answer the question, set needsOwner true.
- llm.ts: OpenAI call, model from OPENAI_MODEL (spike S3: confirm the key works, the JSON validates with zod, and a 150-token answer returns fast).
- decide.ts: the four outcomes from SPEC §7 as a pure function.
Tests against seed/*.json: Priya on ACT-7 peak current sees act-01 to act-03 and nothing restricted; Guest on pack current sees bat-01 plus only the hint for bat-02; the guard blocks "PELICAN", "$4.15" and "BAT-5520" for both Guest and Priya; hidden full text never appears in the model prompt; decide returns each of the four outcomes.
```

### C4 · Expert and feed actors, plus `shared/actors.ts` (needs C1 and C3)

```text
Build the Terse actors per SPEC §9, using what S1 proved (docs/spike-notes.md). Structure: write the expert logic as plain TypeScript functions over a state object that return the new state; the Terse actor is a thin shell that holds the persisted state, calls those functions and reassigns the result. That keeps it testable without the SDK, sidesteps the array bug, and lets a JSON file stand in for Terse if S1 fails. Read SPEC §6 to §9, §16 and §17 (Terse list) only. Order matters: the other lane needs the console-facing calls first.

Phase 1 (target 12:15)
- actors/expert-agent.ts with @Persisted profile, knowledge, policy, pending, audit (cap 200) and stats, and the methods seed(), reset(), snapshot(), setSensitivity(), setClearance().
- actors/feed.ts with push(), recent(), reset().
- shared/actors.ts exporting expert(team: TeamId): ConsoleActorApi and feed(): FeedApi, as defined in shared/types.ts.
Commit and tell me.

Phase 2 (target 13:00)
- prepare(ask) and finalize(ask, draft) using engine/. If S1 says @Interleave + fetch works, instead expose one ask(sender, ask) method that does prepare, then the llm draft, then finalize inside the actor, so text never leaves it. The console-facing calls stay unchanged either way.
- ownerReply(reply): close the escalation; save the entry only if reply.save (title = the original question, source "owner_answer", the chosen tier and tags); log "learned".

Rules: reassign arrays, never push; dedupe by requestId; clearance comes from the sender passed in, never from the ask body; one audit event and one feed event per question; update stats.

Tests on the seed: all four outcomes; an escalation is created for the regen question; after ownerReply the same question from Guest is answered instantly (stats.repeatsServed goes up by 1); setSensitivity and setClearance change the next answer; audit is capped at 200; reset restores the seed.
```

### C5 · Bridge and terminal scripts (needs C2 and C4)

```text
Build bridge/expert-bridge.ts (one process per team: `bun bridge/expert-bridge.ts battery`) and two terminal scripts. Read SPEC §4, §10 and §17 (Relay list) only.
- Bridge: connect() as expert-<team>. On `ask`: validate, call the actor with the Relay-stamped sender, push a feed event, send `answer`. When the status is `escalated`, also send `escalation_notice` to `console`. On `owner_reply` from `console`: call actor.ownerReply, then send the owner's final `answer` (provenance "owner") to the original asker. Only text that passed the guard is ever sent. Log one line per message.
- scripts/ask.ts <asker-agent> <team> "<question>": sends an ask as that agent, prints the answer and any later owner answer.
- scripts/owner-reply.ts <team> <escalationId> "<text>" [--save --tier public --tags a,b]: sends an owner_reply as `console`.
Milestone 13:00: question in, cited answer out from the terminal, for battery and actuators, as asker-priya and asker-guest.
```

### C6 · Escalate-and-learn end to end, plus the durability beat

```text
Run the whole loop from terminals and fix what breaks. Read SPEC §8, §12 (beats 1, 2, 2½, 3) and §16 only.
1. Priya asks actuators the regen question: she gets "escalated" and an escalation_notice reaches `console`.
2. owner-reply with Marcus's scripted answer (SPEC §11), --save --tier public --tags regen,braking: Priya gets the owner's answer marked as Marcus's.
3. Guest asks the same regen question: instant answer from the learned entry (the title is the original question, so keyword retrieval clears minMatchScore).
4. Durability: kill the actuators bridge right after the escalation, send the owner reply while it's down, restart it. Priya still gets the answer (the pending escalation lived in the actor; the reply waited in Relay's queue).
5. Replays: deliver the same ask twice. It is handled once.
Add scripts/beat-check.ts that runs beats 1 to 3 and 2½ against the running stack and prints pass or fail per beat.
```

### C7 · Guard hardening against the six attacks

```text
Read SPEC §7 and §12 (red team). Send the six prompts in seed/attacks.json to `battery` as asker-guest through the bridge, exactly as typed (no asker model in between).
Pass: no planted secret appears in any answer; every attempt is in the audit log; stats.blocked stays 0 (the model never saw the secrets, so the guard should not need to fire).
Then try variants: other languages, base64, spelled-out numbers, and "ignore previous instructions" hidden inside a normal-looking question. Check the guard's false-positive risk from SPEC §7 against every public and internal answer the demo produces.
```

### C8 · Stretch, only after beat 4 passes

```text
Expert-to-expert asks. Read SPEC §6, §10 and §16 (item 2). Let the Actuators expert DM the Battery expert about the BMS state at its own clearance (set expert-actuators' clearance in Battery's policy) and merge the answer into the reply. No new agents. This is the strongest story for the Agent Relay prize.
```
