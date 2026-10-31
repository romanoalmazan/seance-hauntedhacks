# Durability+ : kill the bridge AND the Terse dev server (optional, stronger beat 2½)

For the Stateful Apps prize. Beat 2½ today restarts only the actuators bridge. This variant also restarts the
Terse dev server, so the judges see the pending escalation survive the process that holds the state.

**Tested 5 of 5 on the demo laptop (14:04, real model, CONSULT=1):** pending escalation survived, the console card
stayed, Priya got Marcus's answer about 215 ms after Send, learned = 1, and Guest's beat 3 still answered from act-L1
(+ bat-01 consult). The restart takes about 7 s (Terse recompiles), so fill it with the line below.

## Steps (replace beat 2½'s two terminal commands)

After beat 2's card appears. Terminal at the repo root. **Kill both:**

```sh
pkill -f "expert-bridge.ts actuators"; pkill -f 'terse actor dev'; pkill -f runActorDev
```

Say: "The bridge and the actor host are both gone. The question Marcus has to answer lived in the actor." (The card
may show an error or go stale for these seconds; don't click it.)

**Restart both** (one paste; it waits for Terse to be ready, about 7 s):

```sh
: > actors-dev.log; nohup bun run actors:dev > actors-dev.log 2>&1 & until grep -q Ready actors-dev.log; do sleep 0.3; done; nohup bun bridge/expert-bridge.ts actuators >> bridge-actuators.log 2>&1 &
```

**Then** Marcus types into the card, ticks Save, tier public, tags regen, braking, clicks Send.

Should appear on Priya's page, in under a second: the same reply turns into the purple "Marcus's answer" pill with
Sources: act-L1. Console: Learned 1.

Say: "Both processes died. The escalation was still there when the actor came back, because it is a Durable Actor."

## Don't

- **Don't click Send while Terse is down.** The console's /owner-reply and /cards return "server error" until the
  dev server is back (the console reads the expert's snapshot), and nothing is sent. Tested: the card comes back after
  the restart and Send works then. (Today's beat 2½, with only the bridge down, is different: there the reply waits in
  Relay's queue. Keep that version if you want the "Relay queue" line; use this one for the "Durable Actor" line.)
- Don't ask Battery anything during those ~7 s: both actors live in the one dev server.

## Trade-off

Today's 2½ shows Relay's durable queue (reply sent while the bridge is down). This variant shows Terse's durable state
(the escalation survives the actor host). You can't show both in one restart, because the console needs the actor up
to send. Pick per audience: Agent Relay judges, keep 2½; Stateful Apps judges, use this.
