# For the core lane: alignment check with the surfaces lane

Paste the block below into your core-lane Claude Code session (a fresh one, started in the repo root). Then send the surfaces lane its reply.

```text
Alignment check with the surfaces lane. Don't change shared/types.ts or
shared/protocol.ts (tell me if you think they need a change). For each item, check
your code (actors/, bridge/, shared/relay.ts, shared/actors.ts), fix any mismatch in
your lane, then reply with a list: item number, then OK, or what you changed, or what
you need from me.

From the asker:
1. Every `answer` the bridge sends has `team` set and is sent as exactly expert-<team>.
2. The owner's late answer (after owner_reply) reuses the ask's ORIGINAL requestId,
   sets provenance "owner" and ownerName, and is sent from expert-<team>.
3. /raw asks arrive with a requestId prefixed `raw-` and the question exactly as typed
   (PII intact). Treat requestIds as opaque and do not special-case /raw: it goes
   through the same clearance, retrieval, draft and guard as any ask.
4. Normal asks arrive with @team mentions removed and PII replaced by
   [email removed] / [phone removed].

From the console:
5. `console` is a registered Relay agent. escalation_notice goes to `console` from
   expert-<team> with a matching teamId (otherwise the console drops it).
6. owner_reply reaches expert-<team> with the original requestId; ownerName comes from
   snapshot().profile.
7. The audit log gets an event for every outcome, including refused and guard_blocked.
   For refused/partial, `entriesWithheld` lists ids that exist in knowledge.
   `leakPrevented` is true only when the guard blocked an answer.
8. Stats: answeredAuto counts answered + partial + repeat answers; repeatsServed is the
   subset served from owner-learned entries; blocked counts only guard fires and stays
   0 for the beat 4 attack.
9. feed().recent(n) returns the newest n events with an ISO `time`; feed().reset()
   clears it; the console's Reset calls reset() on battery, actuators and the feed.
10. What does the audit log record for an owner reply with Save unticked? The console
    fake logs `answered` and only bumps `learned` when Save is ticked. Tell me what
    yours does.
```
