# Séance

**Ask the agent, not the engineer. Data stays home, answers travel.**

Séance gives every team its own expert agent, so you can ask the agent instead of the engineer, and restricted knowledge never leaves the team. Built at Haunted Hacks, 2026-10-31.

In every company one engineer knows the battery limits, and everyone pings that person. Most internal Q&A bots put one shared bot over all the documents: one leak point and one set of rules for everyone. In Séance, your agent asks the expert of the team you name. The expert filters by your clearance before the model reads anything, and if it doesn't know, it asks its human owner once, then answers everyone else from the saved answer.

XYZ Company, its teams and its people are fictional.

## What you'll see

1. **Instant answer.** Priya asks `@actuators` and `@battery` about the ACT-7 controller. Both experts answer with sources, and nobody is pinged.
2. **Unknown question escalates, once.** Actuators doesn't know, so Marcus gets a card in the console. The Actuators bridge is killed before he replies, and Priya still gets his answer when it restarts.
3. **Ask once, answered for everyone.** Guest asks the same question and gets Marcus's saved answer with nobody asked. On a pack question, Guest sees only the public facts, a withheld count and a hint.
4. **The boundary holds.** Guest sends a prompt injection straight to the Battery expert. It refuses, the audit log records the attempt, and the Red team button shows "6 of 6 blocked".

**Expert to expert.** With `CONSULT=1`, beat 3 also shows the Actuators expert asking the Battery expert over Relay by itself, at its own public clearance, and merging the reply. See `docs/c8-demo.md`.

## Architecture

```text
Priya, Guest                                      Dana, Marcus
     |                                                 |
     v                                                 v
Asker agent  <--- DMs, text only --->  AGENT RELAY  <--- DMs --->  Owner console
(one per person)                            ^                       |  reads snapshots and the feed,
                                            | DMs                   |  sets tiers and clearance
                                            v                       |
                                      Expert bridge                 |
                                      (one per team)                |
                                       |         |                  |
                       ask, owner reply|         | events           |
                                       v         v                  |
                 Expert actor (one per team)    Feed actor  <-------+
                 knowledge, policy, pending,    event timeline
                 audit, stats                         
                 the only place restricted text lives
                       |  ^
     visible text only |  | draft
                       v  |
                     Model
```

The expert actor picks what the asker's clearance allows, sends only that text to the model, guards the draft, then decides and logs. The bridge sends the result back over Relay.

## How it uses the sponsor tools

**Terse Durable Actors (Stateful Apps).** Each team's knowledge, policy, pending escalations, audit log and stats live in that team's actor, and it is the only place restricted text lives. Clearance filtering, the guard and the decision all run there, in code rather than in a prompt. A pending escalation lives in the actor, not in the bridge, which is why the answer survives killing the bridge in beat 2. A second, shared actor keeps the event timeline the console displays.

**Agent Relay (Agent to agent).** The askers, the experts and the console are separate Relay agents, and every ask, answer, escalation and owner reply is a DM between them. The Relay sender is the only proof of who is asking, so writing "I'm the Battery team lead" in a question gains nothing, and unknown senders get the default clearance. Relay carries approved text, never files. Marcus's reply in beat 2 waits in Relay's durable queue until the bridge comes back.

## How to run it

You need Bun and Node, because the Relay engine runs on Node. Everything runs locally on one laptop, and only the model call needs the network.

```sh
cp .env.example .env
bun install
```

In `.env`:
- Add the line `CONSULT=1` for the expert-to-expert consult. Put it in `.env`, not on the command line, so it survives the bridge restart in beat 2.
- Fill in `OPENAI_API_KEY` and `OPENAI_MODEL` to use a model. Leave them empty and an offline drafter quotes the visible entries instead, so the answers read like a list.

Then start everything:

```sh
scripts/demo.sh         # starts the whole stack and prints the URLs
bun scripts/warmup.ts   # once, so the first demo answer isn't the slow one
```

| Screen | URL |
|---|---|
| Owner console | http://127.0.0.1:3000 |
| Priya | http://127.0.0.1:3001 |
| Guest | http://127.0.0.1:3002 |

Press **Reset** on the console before every run, then follow `demo-script.txt`, the word-for-word script for every beat. Stop with `scripts/demo.sh stop`. Starting by hand, failures and fallbacks are in `docs/RUNBOOK.md`.

## Checks

| Command | What it checks | When it can run |
|---|---|---|
| `bun test` | Unit and server tests | Any time. Nothing needs to be running. |
| `bun scripts/redteam.ts` | The six seeded attacks: no protected token in any response, and every attempt in the audit log | With the stack up: it needs the Guest asker on 3002 and the console on 3000. Safe next to the live demo. |
| `bun scripts/beat-check.ts` | Beats 1, 2, 2½ and 3 through Relay and the actors. Should end with `6/6 passed`. | With the Relay engine, Terse dev server and both bridges up, and the askers and console **stopped**. It connects as those agents, resets the demo state and restarts the actuators bridge. |
| `bun scripts/guard-check.ts` | The six attacks plus variants, sent straight through the bridge | With the asker servers **stopped**, because they connect as `asker-guest` and would take the answers. On the live stack, use `redteam.ts`. |

## Repo map

| Path | What's there |
|---|---|
| `actors/` | The Terse project: expert actor and feed actor |
| `engine/` | Retrieval, disclosure, guard, decision and the model call |
| `bridge/expert-bridge.ts` | One process per team, between Relay and the actor |
| `asker/` | Chat page and asker agent server |
| `console/` | Owner console page and server |
| `shared/` | Types, the Relay message protocol, and the Relay and actor clients |
| `seed/` | Each team's knowledge and the red team attacks |
| `scripts/` | Demo launcher, Relay setup, reset, warmup and the checks |
| `demo-script.txt` | The operator's script |
| `docs/` | Runbook, consult demo, submission text, spike notes, issues |
| `SPEC.md` | The product spec |
| `kickoff/` | The build task prompts |
