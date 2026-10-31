# Spike notes

## S2

**Verdict: PASS.** Local engine + `@relaycast/sdk` 12.3.0 works; `bun scripts/spike-s2.ts` -> 6/6 checks.

**Engine (real one):** npm package `@relaycast/engine@12.3.0` (bin `relaycast-engine`, Node + SQLite). Nothing listens on 127.0.0.1:7528; that daemon is not what we use.
- Install gotcha: its dep `better-sqlite3@^11` fails to build on Node 26. Fixed with `"overrides": {"better-sqlite3": "^12.4.1"}` in package.json (resolves 12.11.1, prebuilt). Plain `npx @relaycast/engine` will hit the same build failure on Node 26, so use the repo copy.
- Start (from repo root):
  `nohup node node_modules/@relaycast/engine/dist/bin/serve.js --db ./relaycast.db --port 8787 > relay-engine.log 2>&1 &`
- `RELAY_BASE_URL=http://localhost:8787` (also the default in code). Health: `curl localhost:8787/health` -> `{"ok":true,...}`.
- `relaycast.db*` added to .gitignore. Wiping the db invalidates `.relay-tokens.json`: delete both and re-run setup.

**Setup:** `bun scripts/setup-relay.ts`. Reuses `RELAY_WORKSPACE_KEY` or the saved key if it still works, otherwise creates a workspace; registers expert-battery, expert-actuators, asker-priya, asker-guest, console; checks saved tokens with `me()`. Writes `.relay-tokens.json` = `{ baseUrl, workspaceKey, agents: {name: token} }` (mode 600). Safe to re-run.

**SDK family:** `@relaycast/sdk` 12.3.0 (`RelayCast` workspace client + `relay.as(token)` AgentClient). It does have a TS DM call (`me.dm(name, text)`), so the REST fallback isn't needed. Calls used:
`RelayCast.createWorkspace(name, {baseUrl})`, `relay.agents.register({name,type:'agent'})` (duplicate -> error status 409 "already exists"), `me.subscribe(['@self'], cb)` + `me.connect()`, `me.dm()`, `me.deliveries()`, `me.ackDelivery(id)`, `me.on.connected/resynced/reconnecting`, `me.disconnect()`.
REST underneath (from the SDK): POST /v1/workspaces, POST /v1/agents, POST /v1/dm, GET /v1/deliveries, POST /v1/deliveries/:id/ack, WS /v1/node/ws.

**Event shape:** `dm.received` -> `{ id, type, conversationId, message: { id, agentId, agentName, text } }`. `message.agentName` is the Relay-stamped sender name, and that's what `ctx.sender` is.

**Surprises**
- A DM to an offline agent becomes a durable delivery (`status: queued`, `expiresAt` = +1h). `deliveries()` returns it with the full message; on reconnect the SDK also replays it over the socket.
- The SDK force-enables `autoAckDeliveries` on the agent socket (it can't be turned off), so socket frames are acked on receipt, before our handler runs. A crash mid-handler can lose that message. Acceptable for the demo.
- `inbox()` shows unread DMs but doesn't carry deliveries; we don't use it.
- Queued deliveries expire after 1h.

**shared/relay.ts API:** `connect(agent, opts?: {baseUrl?, token?, log?}): Promise<RelayClient>` (protocol.ts interface: `agent, send(to,msg), onMessage(h), close()`). Also exports `loadTokens()` and `logicalKey(sender,msg)`.
- Drains `deliveries()` and acks each item on start (before resolving), and again on every `connected`/`resynced` event.
- Messages that arrive before the first `onMessage` are buffered, then handed to that first handler.
- Drops: own messages, bodies that fail `parseMessage` (still acked), duplicates.
- **Dedupe** (per client, in memory); either key hit drops the message:
  1. Relay message id.
  2. `sender|kind|requestId|disc`, where disc is: answer -> `provenance/status`; owner_reply and access_decision -> escalationId; escalation_notice -> escalation.id; ask -> `to`.

  So the asker gets both the `escalated` answer and the later owner answer for one requestId, and an identical re-send is dropped. Consequence: one sender can't send two asks with the same requestId to the same team (correct anyway).

**Not tested:** recovery after an engine restart while clients stay connected (the SDK auto-reconnects; we re-drain on `connected`).

## S1

**Verdict: PASS. Package family is `terse-sdk` + `terse-cli` (0.14.9).** `terse-sdk` itself depends on `durable-actors@0.14.6` and re-exports its decorators, but we only ever import from `terse-sdk/*`. Never import `durable-actors` directly. Local dev needs no account or login. Bun 1.4.4.

**Model call inside the actor: YES.** An `@Interleave` method doing outbound `fetch` works (example.com 200, ~280 ms) and other calls interleave during the await. A real OpenAI call wasn't run because `OPENAI_API_KEY`/`OPENAI_MODEL` are empty in `.env` right now. The `askModel` method in `actors/src/hello.ts` is ready to re-test once they're filled in.

### Commands
```bash
export PATH="$HOME/.bun/bin:$PATH"
bun add terse-sdk@0.14.9 && bun add -d terse-cli@0.14.9   # done; in package.json

bun run actors:dev    # = cd actors && terse actor dev  -> http://127.0.0.1:7100 (watches actors/src, hot-recompiles)
bun run actors:gen    # = terse actor generate --out-dir actors/generated --non-interactive  (run from repo root while dev server is up)
bun scripts/spike-s1.ts phase1 spike-1   # writes + latency + fetch + interleave + dormancy
bun scripts/spike-s1.ts phase2 spike-1   # read-only, run after restarting dev server
```
Rerun `actors:gen` after any change to an actor's public methods. Body-only changes are picked up automatically.

### Layout that works
- `actors/` is its **own Terse actor project root**. It has `actors/package.json` (minimal, no deps, which resolve from the root `node_modules`) and `actors/tsconfig.json`. `terse actor dev` must run with cwd = `actors/`.
- The entrypoint **must** be `actors/src/actor.ts` (the CLI looks for `src/actor.ts`, then the legacy `src/actors.ts`). Export every actor class from it. Put real actors in `actors/src/*.ts` and re-export them.
- **Decorators are TC39 standard decorators, not legacy ones.** The root `tsconfig.json` has `experimentalDecorators: true`, which is the wrong flavor for actors. `actors/tsconfig.json` sets it to false and covers `actors/src`. Don't type-check actor files with the root tsconfig. (Ask surfaces/contract owner to drop `actors` from root tsconfig `include`, or ignore tsc errors there.)
- Client: `actors/generated/` (generated, self-contained runtime, no extra deps). Commit it or regenerate. Your choice; it's small.
- State lives in `actors/.durable-actors/` (it ships its own `.gitignore` `*`). To wipe all actor state: stop the server, then `rm -rf actors/.durable-actors`.
- Actor ids are free strings: `actors.Expert.get("battery")`.

### Code that works
```ts
// actors/src/hello.ts
import { Actor, Persisted, Ephemeral, Interleave } from "terse-sdk/actor"
export class Hello extends Actor {
    @Persisted count = 0
    @Persisted items: string[] = []
    @Ephemeral scratch = 0
    async add(x: string) { this.items = [...this.items, x] }      // reassign, never push
    @Interleave async ask(q: string) { const r = await fetch(...); return ... }
}
// actors/src/actor.ts
export { Hello } from "./hello"

// any plain bun script / bridge (repo root)
import { actors } from "../actors/generated/index.js"
const hello = actors.Hello.get("spike-1")
await hello.increment(1)          // every method is async RPC over HTTP to 127.0.0.1:7100
```
Methods take and return plain JSON. No extra client config is needed for local; it defaults to `http://127.0.0.1:7100/v1/projects/local/actors` (matches `TERSE_ACTOR_URL` in `.env`).

### Proven results
| Check | Result |
|---|---|
| (a) restart survival | count=1 and reassigned=["a","b"] read back after killing and restarting the dev server (twice) |
| (b) push vs reassign | `pushed` showed ["a","b"] *in memory* while warm, but was **[] after dormancy/restart**. `reassigned` survived. Watch out: in-place push *looks* fine until the actor sleeps (~10 s idle), so tests that don't wait will miss the bug |
| (c) @Interleave + fetch | a `read()` sent during an in-flight `fetchExample()` returned at 4 ms vs 16 ms, so the calls interleaved. example.com 200 |
| (d) latency | first call to an actor (cold) 75-115 ms. Warm read ~1 ms. Write ~13-15 ms (persist). After 15 s idle (dormant) 113 ms. First call after server restart 73-96 ms. Brand-new actor id 78 ms |
| (e) secrets | the actor sees `process.env`. `terse actor dev` loads **`.env` from its cwd (`actors/.env`) only**, not the repo-root `.env`, plus whatever the shell exports. Fix applied: `actors/.env` is a **symlink to `../.env`** (gitignored by the `.env` pattern), and the actor then saw OPENAI_*, RELAY_*, TERSE_*. The actor's `process.cwd()` is `actors/` |

### Surprises / not done
- `terse deploy` was **skipped**. `terse auth status` returns "Not logged in", and `terse auth login` (even `--no-browser`) needs a human to finish the browser flow. A human could run `terse auth login` and then `cd actors && terse deploy` if hosted is wanted. The demo is planned local anyway.
- The `terse` bin has a `#!/usr/bin/env bun` shebang, so bun must be on PATH (`bun run actors:dev` handles this).
- `terse-sdk` pulls zod 4 nested under `node_modules/terse-sdk/node_modules`. The root stays on zod 3.25. No conflict seen.
- One dev server at a time (it takes `actors/.durable-actors/runtime.lock`). Stop it with Ctrl+C, or `pkill -f 'terse actor dev'; pkill -f runActorDev`.
- Throwaway files to delete once real actors exist: `actors/src/hello.ts` (and its re-export in `actors/src/actor.ts`), `scripts/spike-s1.ts`.

## Core stack: how to run it (verified 2026-10-31 ~12:00)

```sh
export PATH="$HOME/.bun/bin:$PATH"
nohup node scripts/relay-engine.mjs --db ./relaycast.db --port 8787 > relay-engine.log 2>&1 &   # 127.0.0.1 only
bun scripts/setup-relay.ts                     # idempotent
bun run actors:dev                             # Terse dev server, 127.0.0.1:7100 (run actors:gen after changing public actor methods)
bun bridge/expert-bridge.ts battery            # one terminal each
bun bridge/expert-bridge.ts actuators
bun scripts/beat-check.ts                      # beats 1, 2, 2½, 3 + replay -> 6/6
bun scripts/guard-check.ts                     # 6 seed attacks + 7 variants, 0 leaks
bun scripts/ask.ts asker-priya actuators "Does ACT-7 support regenerative braking into the pack?"
bun scripts/owner-reply.ts actuators <escalationId> "<text>" --save --tier public --tags regen,braking
```

- The model call runs inside `ExpertAgent.ask` (`@Interleave`). Without `OPENAI_API_KEY` + `OPENAI_MODEL` (or with `LLM_FAKE=1`) a deterministic drafter quotes the visible entries, so everything runs offline.
- Actor ids: `ExpertAgent` = `battery` / `actuators`, `Feed` = `main`. The seed files carry no policy; the demo policy (Priya 1, Guest 0, default 0, minMatchScore 2, minConfidence 0.6) is `DEMO_POLICY` in `actors/src/expert-logic.ts`.
- Terse compiles with `nodenext` resolution: relative imports in `actors/src`, `engine/` and anything they import need `.js` extensions, and JSON imports need `with { type: "json" }`. Every actor method must be async (helpers are module functions).
- Questions with injection phrasing ("ignore your rules", "system prompt", "verbatim", "override", base64, ...) are refused outright instead of escalated, so a red-team run doesn't page the owner.
- Retrieval scores title + tags + releasable hint (not the full text); entries under half the top score are dropped.

## C8 stretch: expert-to-expert consult (`CONSULT=1`)

Off unless `CONSULT=1` is in `.env` (put it there, not on the command line: the beat 2½ hand restart of the actuators bridge only keeps it via `.env`). When the Actuators answer, or the full text of any entry it used, names Battery or the BMS (the actor returns this as `refersTo`; e.g. act-L1 says "check with Battery first"), the actuators bridge DMs `expert-battery` as `expert-actuators` with "What continuous and peak current can the pack handle?", waits up to 12 s, and appends "I checked with the battery expert: ..." plus Battery's sources. Battery's withheld hints are not merged (they describe what Battery kept from the Actuators agent, not from the asker). If Battery doesn't answer or escalates, the original answer goes out unchanged.

`expert-actuators` has clearance 0 in the demo policy on purpose: whatever Battery tells it can be relayed to any asker, Guest included, so it must be public-only. Battery's audit log shows `expert-actuators` as the asker. Verified live through the Guest chat: beat 3 regen answer merged bat-01 in ~2.6 s total; no owner card; redteam 6 of 6. Demo steps: docs/c8-demo.md.
