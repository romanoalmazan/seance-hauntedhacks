# Runbook

## Start, reset, stop

From the repo root:

```sh
scripts/demo.sh        # starts everything on one laptop with REAL=1 and prints the URLs
scripts/demo.sh stop   # stops what it started, plus any detached bridge
```

`demo.sh` refuses to start if a demo port (8787, 7100, 3000, 3001, 3002) is taken, and cleans up after itself if a step fails, printing the last lines of that step's log. Its PIDs are in `/tmp/liaison-demo.pids`. If `stop` says a port is still listening, something was restarted by hand and isn't in that file: use the `pkill` lines under "Stop everything".

**Reset before every run.** Press **Reset** on the console. Both experts, the feed and the open cards go back to the seed, learned entries are removed, and both chat pages clear themselves. Don't reload them.

`bun scripts/reset.ts` does the same from a terminal, with one difference: it can't clear the Red team result or the status line on an open console page, because those live only in the page. Use the button during a demo.

If the console's status says `Reset, but not cleared: asker-guest` (the script says the same and exits 1), the experts were reset but that chat's server is down. Start it with `REAL=1 nohup bun asker/server.ts asker-guest > asker-guest.log 2>&1 &`, give the page a few seconds to reconnect by itself, and press Reset again.

**Tiers and clearance** are at the bottom of the console, and Reset restores both. If the Guest page is dropped, set `asker-priya` to `0, public` and Priya's chat answers as Guest's would on both teams, though the Red team button still needs the Guest asker's server on port 3002.

`bun scripts/redteam.ts` runs the six attacks from a terminal and exits non-zero if any fails. The console's **Red team** button runs the same check. A failed prompt shows why: a leaked token, no audit entry, or the Guest asker not running.

The operator's word-for-word script is `demo-script.txt`.

## Before the first run

1. **Consult.** Add the line `CONSULT=1` to `.env`. Don't put it on the command line: Bun loads `.env` for every bridge start, so only there does it survive the beat 2½ hand restart. Without it, beat 3 has no expert-to-expert consult. See `docs/c8-demo.md`.
2. **Start.** Run `scripts/demo.sh`, then check it: `grep listening bridge-actuators.log` ends with `consults battery`. After a hand restart the log is appended to, so read the last line.
3. **Warm up.** Run `bun scripts/warmup.ts` once. It makes one call per expert through the actor, so the first demo answer isn't the slow one, then resets the experts and the feed.
4. **Reset.** Press **Reset** on the console, then start the demo.

## Most likely failures

The first three are the likely ones from SPEC §15. The stack already runs on its other fallbacks: local Terse dev server, local Relay engine, one laptop.

1. **The model makes the beats drag.** Answers take several seconds, or the expert keeps escalating (a failed model call escalates). Set a smaller, faster model in `OPENAI_MODEL` in `.env`, then run `scripts/demo.sh stop` and `scripts/demo.sh`, because the actor reads it at start. Warm it with `bun scripts/warmup.ts`, then Reset. If the model can't be fixed in time, empty `OPENAI_API_KEY` and `OPENAI_MODEL`: the offline drafter needs no network and the beats still pass.
2. **The venue Wi-Fi is bad.** Only the model call needs the network, because Relay and Terse are local here. Move the laptop to a phone hotspot. Failing that, use the offline drafter as above.
3. **The demo drifts under pressure.** A wrong prompt, a stale screen or a beat that goes sideways. Use the fixed prompts in `demo-script.txt`, press Reset and restart the beat. If a beat still won't run, play the backup recording from 15:15.
4. **Beat 3 shows no consult.** No "I checked with the battery expert:" paragraph, no bat-01 source. Check that `.env` has `CONSULT=1`, then restart the actuators bridge: `pkill -f "expert-bridge.ts actuators"`, then `nohup bun bridge/expert-bridge.ts actuators >> bridge-actuators.log 2>&1 &`. The last `listening` line should end with `consults battery`. Do this between runs, not mid-demo. If it's already on, the bridge only consults when the Actuators answer names Battery or the BMS, so a model rewording can skip it; the answer still goes out, and Reset and retry.

## Running the real stack

`scripts/demo.sh` runs all of this. These are the same steps by hand. Everything runs on one laptop, from the repo root. Logs land in the repo root as `*.log` (gitignored). Each block below was run as written.

### Once per machine

```sh
bun install
[ -f .env ] || cp .env.example .env
ln -sf ../.env actors/.env
```

Leave `OPENAI_API_KEY` and `OPENAI_MODEL` empty to use the offline drafter, which quotes the visible entries (so answers carry `[act-01]`-style tags and read like a list). To use a model, fill both in `.env` and restart the Terse dev server, because the actor is what reads them. The model path (gpt-4.1-mini) has been run on the core lane's machine: beat 1 and beat 3 answers came back in 28 to 63 words, about a second each, cited with [id]. Run it once on the demo laptop before rehearsing.

### 1. Start the core stack

```sh
nohup node scripts/relay-engine.mjs --db ./relaycast.db --port 8787 > relay-engine.log 2>&1 &
until curl -s -o /dev/null localhost:8787/health; do sleep 0.2; done
bun scripts/setup-relay.ts
nohup bun run actors:dev > actors-dev.log 2>&1 &
until curl -s -o /dev/null 127.0.0.1:7100; do sleep 0.2; done
nohup bun bridge/expert-bridge.ts battery > bridge-battery.log 2>&1 &
nohup bun bridge/expert-bridge.ts actuators > bridge-actuators.log 2>&1 &
```

`scripts/relay-engine.mjs` is the stock engine bound to 127.0.0.1, so nobody on the venue Wi-Fi can reach it. `scripts/setup-relay.ts` is safe to re-run. It reuses `.relay-tokens.json` while the tokens still work.

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

Press **Reset** on the console. See "Start, reset, stop" above.

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
pkill -f 'relay-engine.mjs'
```

### Starting over from nothing

Wiping the Relay database invalidates the saved tokens, so remove both together, with everything stopped:

```sh
rm -f relaycast.db* .relay-tokens.json
rm -rf actors/.durable-actors
```

Then start again from step 1.
