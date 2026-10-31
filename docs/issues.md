# Issues for the surfaces lane (from core, 2026-10-31 ~13:30)

## 1. demo.sh: start the Relay engine on 127.0.0.1 only
Today `scripts/demo.sh` line ~91 starts `node node_modules/@relaycast/engine/dist/bin/serve.js ...`, which listens on `*:8787`
(every interface; anyone on the venue Wi-Fi can create a workspace or read the stream). Repro:
`lsof -nP -iTCP:8787 -sTCP:LISTEN` shows `TCP *:8787`; `curl http://$(ipconfig getifaddr en0):8787/health` answers.
Fix: replace that command with `node scripts/relay-engine.mjs --db ./relaycast.db --port 8787` (same flags; core's launcher
binds 127.0.0.1). Verified: lsof shows `127.0.0.1:8787`, the LAN curl is refused, beat-check 6/6, guard-check 0 leaks.
The `pkill`/stop pattern for the engine needs to match `relay-engine.mjs` too.

**Done by surfaces in d385e7e:** `scripts/demo.sh` starts the launcher and `stop` matches it. Verified: lsof shows `127.0.0.1:8787`, the LAN curl is refused, redteam 6 of 6, nothing left after stop.

## 2. CONSULT=1 (C8) must live in .env, not on the demo.sh command line
If you turn C8 on, put `CONSULT=1` in `.env`. Beat 2½'s hand restart (`nohup bun bridge/expert-bridge.ts actuators ...`
in demo-script.txt) doesn't inherit a command-line env var, so with `CONSULT=1 scripts/demo.sh` the consult silently stops
after beat 2½. Bun loads `.env` on every start. Steps and expected screen: docs/c8-demo.md.

## 3. demo-script.txt beat 3 text, if CONSULT=1 is the default
The first beat 3 answer gains a paragraph "I checked with the battery expert: ..." and Sources act-L1 + bat-01, about 1 s
slower; Battery's counters (Interruptions avoided) go up by one more. Everything else in the script is unchanged.

## 4. demo-script.txt: wording note
The script says answers' wording is from the offline drafter. With gpt-4.1-mini the answers are 2-4 sentences of prose
with inline [id] citations (e.g. "... below 40 °C [bat-01]."). Pills, sources, counters and hints match the script.

## 5. Before every run: scripts/warmup.ts
Order: `scripts/demo.sh`, then `bun scripts/warmup.ts` (one model call per expert, ~1 s each, then resets experts+feed),
then press Reset on the console. Worth a line in demo-script.txt "Before every run" and the RUNBOOK.

## 6. Pre-demo checklist: scripts/preflight.ts (new, ~13:45)
Order before going on stage: `scripts/demo.sh`, `bun scripts/warmup.ts`, press Reset, then `bun scripts/preflight.ts`.
It prints green/red per line and exits 1 on any red: five ports on 127.0.0.1, both bridges listening (and
"consults battery" when CONSULT=1), OpenAI key/model set and a real call < 3 s, experts and feed empty, .env mode.
Please add it to docs/RUNBOOK.md and the "Before every run" list in demo-script.txt. Verified all green on main and on a
fresh clone.

## 7. RUNBOOK "Once per machine": chmod 600 .env
`cp .env.example .env` creates a world-readable file (mode 644) holding the OpenAI and Terse keys. Add `chmod 600 .env`
after it. preflight.ts flags it red until then.

## 8. Behavior changes you may see (no action needed)
- A model failure (timeout ~6 s, network, bad JSON) no longer escalates: one retry, then the deterministic drafter
  answers from the visible entries. No owner card mid-beat if the Wi-Fi hiccups; the answer just reads like a quote list.
- Answers are repeatable (temperature 0, seed 7): same sources every run, wording varies by a few words.
- The consult also fires when the cited entry (act-L1) says "check with Battery", even if the model's wording doesn't.

## 9. Optional: Durability+ beat (Stateful Apps)
docs/durability-plus.md: kill the actuators bridge AND the Terse dev server, restart both, then Marcus sends. 5 of 5 on the
demo laptop. Your call whether demo-script.txt uses it instead of 2½.
Console note: while the Terse dev server is down, POST /owner-reply and GET /cards answer 500 "server error" (they read the
expert's snapshot). The card comes back once Terse is up. If you want the page to say "actor restarting" instead of an
error during those seconds, that's console-side.

## 10. Beat 3b wording (rehearsal, 2 of 2 runs)
demo-script.txt beat 3b says "Only the public envelope (48 V, 30 A continuous, 60 A peak for up to 10 s)". With the real
model the answer is "The pack can deliver a continuous current of 30 A and a peak current of 60 A for up to 10 seconds
while the cell temperature is below 40 °C [bat-01]." (no 48 V: the question asks about current). Pill partial, Sources
bat-01, 1 withheld + the derating hint all match. Suggest dropping "48 V" from the expected text.

## 11. Demo replaced: the Software story (14:30, built by core at the user's request)
The user asked for a different demo. What changed in your files (all committed by path, tests 212 pass):
- **demo-script.txt** rewritten: Sam (Software owner) teaches "X database ingest format" in the console, ticks Controls;
  Priya (Controls) asks `@software What format should data be in to send it to the X database?` -> answered [sof-T1];
  Alex (Robotics) asks the same -> refused with "ask Sam"; Sam ticks Robotics -> Alex answered. Old script: git history.
- **console/**: "Teach your agent" panel (title, details, Teach agent button) + "Which teams can ask the Software agent?"
  checkboxes (Controls, Robotics). New routes POST /teach and POST /team-access. The console shows the Software team only
  (TEAMS in index.html); the per-asker clearance control is hidden; flow strip shows asker-robotics and expert-software.
- **asker/**: the Guest page is now Alex Chen, Robotics (`asker-robotics`, port 3002). @software is first in the directory.
- **scripts/demo.sh** starts the software bridge and the Robotics asker. **seed/attacks.json** asker is asker-robotics
  (redteam 6 of 6). preflight checks three bridges.
- Battery/Actuators still work (beat-check 6/6, guard-check 0 leaks) but aren't in the script.
Please update docs/RUNBOOK.md and docs/DEMO-DAY.md wording (Guest -> Alex, Robotics) and the backup-video script in
docs/SUBMISSION.md to the new story. Don't ask @software before Teach (it escalates to Sam).
