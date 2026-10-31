# Runbook

## Running the real stack

Everything runs on one laptop, from the repo root. Logs land in the repo root as `*.log` (gitignored). Each block below was run as written.

### Once per machine

```sh
bun install
[ -f .env ] || cp .env.example .env
ln -sf ../.env actors/.env
```

Leave `OPENAI_API_KEY` and `OPENAI_MODEL` empty to use the offline drafter, which quotes the visible entries (so answers carry `[act-01]`-style tags and read like a list). To use a model, fill both in `.env` and restart the Terse dev server, because the actor is what reads them. The model path has not been run on the real stack yet.

### 1. Start the core stack

```sh
nohup node node_modules/@relaycast/engine/dist/bin/serve.js --db ./relaycast.db --port 8787 > relay-engine.log 2>&1 &
until curl -s -o /dev/null localhost:8787/health; do sleep 0.2; done
bun scripts/setup-relay.ts
nohup bun run actors:dev > actors-dev.log 2>&1 &
until curl -s -o /dev/null 127.0.0.1:7100; do sleep 0.2; done
nohup bun bridge/expert-bridge.ts battery > bridge-battery.log 2>&1 &
nohup bun bridge/expert-bridge.ts actuators > bridge-actuators.log 2>&1 &
```

`scripts/setup-relay.ts` is safe to re-run. It reuses `.relay-tokens.json` while the tokens still work.

### 2. Check it

Run this **before** step 3, or with the askers and console stopped:

```sh
bun scripts/beat-check.ts
```

It should end with `6/6 passed`. It resets both experts and the feed, connects as `asker-priya`, `asker-guest` and `console`, and kills and restarts the actuators bridge. Running it next to live askers would split their messages with it and wipe the demo state.

### 3. Start the surfaces

`REAL=1` is what selects the real stack. Without it each server quietly runs on fakes.

```sh
REAL=1 nohup bun asker/server.ts asker-priya > asker-priya.log 2>&1 &
REAL=1 nohup bun asker/server.ts asker-guest > asker-guest.log 2>&1 &
REAL=1 nohup bun console/server.ts > console.log 2>&1 &
until curl -s -o /dev/null 127.0.0.1:3000; do sleep 0.2; done
```

| Screen | URL |
|---|---|
| Owner console | http://127.0.0.1:3000 |
| Priya | http://127.0.0.1:3001 |
| Guest | http://127.0.0.1:3002 |

Each server prints which mode it is in: `using the real Relay`, or `(real stack)` for the console. Against the real stack `POST /dev/escalate` on the console returns 404.

### 4. Before every run

Press **Reset** on the console. It resets both experts and the feed, and removes learned entries and open cards.

Reset doesn't touch the chat pages yet, so reload ports 3001 and 3002 after it.

### Beat 2½ by hand

While Priya's question is waiting and its card is open:

```sh
pkill -f "expert-bridge.ts actuators"
```

Send Marcus's reply from the card. The card closes and Priya keeps waiting. Then:

```sh
nohup bun bridge/expert-bridge.ts actuators >> bridge-actuators.log 2>&1 &
```

Priya's bubble turns into Marcus's answer within a few seconds.

### Stop everything

```sh
pkill -f 'asker/server.ts'
pkill -f 'console/server.ts'
pkill -f 'expert-bridge.ts'
pkill -f 'terse actor dev'
pkill -f 'runActorDev'
pkill -f 'engine/dist/bin/serve.js'
```

### Starting over from nothing

Wiping the Relay database invalidates the saved tokens, so remove both together, with everything stopped:

```sh
rm -f relaycast.db* .relay-tokens.json
rm -rf actors/.durable-actors
```

Then start again from step 1.
