# C8 in the demo: the Actuators expert asks the Battery expert

One agent asks another agent over Agent Relay, by itself, at its own clearance. No new agents, no human.

## Turn it on

Add one line to `.env` (gitignored), then start the stack as usual:

```
CONSULT=1
```

Put it in `.env`, not on the command line. Bun loads `.env` for every bridge start, including the
hand restart in beat 2½ (`nohup bun bridge/expert-bridge.ts actuators ...`). With `CONSULT=1 scripts/demo.sh`
instead, the restarted bridge comes back without it and beat 3 shows no consult.

Check: `grep listening bridge-actuators.log` ends with `consults battery`.

## Where it shows: beat 3, first question

Nothing new to type. It rides on the existing beat 3 prompt, after Marcus saved his regen answer in beat 2/2½.

Page: **Guest** (http://127.0.0.1:3002). Type, then Enter:

```
@actuators Does ACT-7 support regenerative braking into the pack?
```

Should appear on Guest's page, about 2 s:
- Actuators, green **answered** pill.
- Marcus's saved answer in the expert's words, then a second paragraph starting
  **"I checked with the battery expert:"** and the pack's public limits (30 A continuous, 60 A peak for up to 10 s below 40 °C).
- Sources: **act-L1** and **bat-01 Pack electrical envelope**. No withheld line.

Should appear on the console:
- Timeline: a Battery row whose asker is **expert-actuators** (the consult), next to the Actuators row for asker-guest.
- Battery's audit log: asker **expert-actuators**, decision partial, withheld bat-02.
- Repeats served +1 (Actuators). Interruptions avoided +2 instead of +1: the Battery consult counts too.

## What to say (one sentence)

"Marcus's answer said check with Battery, so the Actuators agent just asked the Battery agent itself over Relay, at its own public clearance, and merged the reply: agent to agent, no human."

## Who consulted whom, and why it's safe

- `expert-actuators` → DM → `expert-battery`, question: "What continuous and peak current can the pack handle?"
- Trigger: an Actuators answer (answered or partial) mentions Battery or BMS. Only Actuators consults; Battery never does.
- Battery sees the Relay-stamped sender `expert-actuators`, which has clearance **0** in Battery's policy. The merged text can reach any asker, Guest included, so Battery only tells it public facts. Battery's withheld hints are not merged (they describe what Battery kept from the Actuators agent, not from the asker).
- If Battery doesn't answer within 12 s, or escalates, the Actuators answer goes out unchanged.

## Differences from demo-script.txt with CONSULT=1

Only beat 3's first question changes: extra paragraph, extra source bat-01, about 1 s slower, and Battery's counters move by one. Beats 1, 2, 2½, 3b, 4, the red team and the closer are unchanged (verified with beat-check 6/6 and guard-check 0 leaks, with and without CONSULT).
