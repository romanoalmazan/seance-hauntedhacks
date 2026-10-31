# Demo day: running Séance on the core lane's laptop

The live demo and the backup video run on ONE laptop: this one. The keys live only in its `.env` (never in git). The surfaces lane's laptop is the backup machine.

## Set up (once, about 10 minutes)

1. `git pull --rebase origin main`, then `bun install`.
2. `.env` has: `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4.1-mini` and `CONSULT=1` (plus `TERSE_API_KEY` only if you use the cloud actors). Then `chmod 600 .env` and `ln -sf ../.env actors/.env`.
3. Phone hotspot ready (only the model call needs the network). Do Not Disturb on, so no notification lands on the projector. `caffeinate -d &` so the display stays awake. Browser zoom at 100%. Close every other app and tab. Laptop plugged in.

## Before every run

```sh
scripts/demo.sh stop
scripts/demo.sh
bun scripts/warmup.ts          # one model call per expert, then resets
# press Reset on the console
bun scripts/preflight.ts       # every line must say ok
```

Then open Priya `http://127.0.0.1:3001`, Guest `http://127.0.0.1:3002` and the console `http://127.0.0.1:3000`, and follow `demo-script.txt` exactly. Don't refresh a chat page, and don't restart anything during the demo except the scripted beat 2½ bridge restart.

## Who sits where

- **Driver and narrator:** types as Priya and Guest and says the one-sentence tech line per beat.
- **Owner:** plays Marcus and Dana at the console (escalation card with Save ticked, the tier flip, Red team, Reset).

## Timeline

- **Now to 14:30:** two full rehearsals with the real model. After each, send the surfaces lane anything off: which beat, what you typed, what you saw.
- **14:30 to 14:50:** fixes only. After every push from the surfaces lane: `git pull --rebase origin main`, restart with the block above, rerun the beat that failed.
- **14:50:** final pull. Note the commit hash and tag it: `git tag demo-ready`. A UI update that isn't solid by now is dropped, and we keep the last good commit.
- **15:00: code freeze.** No code changes. Two more rehearsals.
- **15:15:** record the 2-minute backup video on this laptop (Cmd+Shift+5, microphone on), following the video script in `docs/SUBMISSION.md`. Save the file in two places.
- **By 16:00:** submit. The platform, deadline and track selection come from the event page.

## If something breaks

`docs/RUNBOOK.md`, "Most likely failures". A model or Wi-Fi hiccup doesn't page the owner: the offline drafter answers instead. If the stack won't come up, play the backup video.
