# Console voice-over: what happened behind the demo

Screen recording of the owner console, http://127.0.0.1:3000, right after the Software skit. About 2½ minutes.
**Don't press Reset before recording**: the console has to show the demo's results.

Expected state after the scripted skit: Interruptions avoided **2**, Requests refused **1**, Guard catches **0**,
Asked **3**, Learned **1**, Repeats served **2**. If Alex also asked something Software doesn't know (e.g. "I need data on
the robotics arm test I did"), there is also an escalation card: use the optional section 4.

Format: **[ON SCREEN]** what to show or point at, then the line to say.

---

### 1 · The counters (0:00–0:20)
**[ON SCREEN]** Top of the page. Hover or point at each counter as you name it.

> This is the owner console: the backend's view of the demo we just ran.
> "Interruptions avoided" is the number of questions an agent answered without pulling in a person.
> "Requests refused" is how many times someone asked about something they weren't cleared to see.
> And "Guard catches" is zero. That zero matters: the guard is the last check before an answer leaves, and it never had
> to fire, because restricted text never reached the model in the first place.

### 2 · Agent-to-agent traffic (0:20–0:50)
**[ON SCREEN]** The flow strip. Point at asker-priya / asker-robotics on the left, Agent Relay in the middle,
expert-software on the right, then the caption in the top right.

> Every person has their own agent, and every agent has a name on Agent Relay.
> When Priya asked "@software", her agent didn't call a shared chatbot. It sent a direct message over Agent Relay to the
> Software team's agent. Relay stamps every message with who sent it, and that stamp is how the Software agent knows
> it's Priya and not someone typing "I'm Priya". Identity comes from the network, never from the question.
> The strip replays the last exchange: here, Alex's agent to the Software agent.

### 3 · Sam's knowledge and who can see it (0:50–1:20)
**[ON SCREEN]** The "Teach your agent" panel and the Controls / Robotics checkboxes. (This mirrors what Sam did with
"Share agent context" on his own chat.)

> When Sam told his agent the X database format, it was saved inside the Software team's Durable Actor, built on Terse.
> That actor is the only place the text lives: one actor per team, holding its knowledge, its sharing rules, its audit
> log and its counters. It survives restarts.
> These two boxes are Sam's sharing rules. Ticking Controls let Priya's agent in. Robotics was unticked when Alex first
> asked, so the actor withheld the entry before the model was even called. It only told Alex that the information
> exists and to ask Sam. When Sam ticked Robotics, the very next answer changed. No redeploy, no prompt change.

### 4 · Optional: the escalation (1:20–1:40)
**[ON SCREEN]** Scroll to "Escalations" and show the card (asker-robotics, reason No knowledge).

> When an agent doesn't know, it doesn't guess. Alex asked the Software agent about a robotics arm test, which it knows
> nothing about, so it escalated to Sam. This card is that request, and it's stored in the actor too, so it survives a
> crash. When Sam answers and ticks Save, his answer reaches Alex over Relay and becomes knowledge, so the next person who
> asks gets it instantly. Sam is interrupted once, not every time.

### 5 · The timeline (1:40–1:50)
**[ON SCREEN]** Scroll to "Timeline".

> The timeline is a live feed of every question, in order. It's kept in its own small Durable Actor, so the console
> doesn't need anyone's raw data to draw it.

### 6 · The audit log (1:50–2:20)
**[ON SCREEN]** Scroll to "Audit log". Point at each row and its Used / Withheld columns.

> And this is the part we'd show a security team. Every decision is recorded: who asked, as stamped by Relay, what they
> asked, and what happened.
> Sam taught his agent: sof-T1.
> Priya asked: answered, using sof-T1.
> Alex asked: refused, with sof-T1 in the Withheld column. That entry was filtered out before the model was called, so the
> model never saw it.
> Alex asked again after Sam shared: answered.
> "Leak prevented" stays "no" because nothing ever tried to leak.

### 7 · Knowledge tiers (2:20–2:30)
**[ON SCREEN]** Scroll to "Knowledge tiers", the Software column with sof-T1.

> Owners see ids and titles here, never the full text on screen. sof-T1 is "internal": only the teams Sam shared with
> can see it, and he can change that at any time.

### Close (2:30–2:45)
**[ON SCREEN]** Scroll back to the top, the counters.

> So, what happened behind the demo: each team's knowledge stays home in its own Terse Durable Actor. Agents talk to each
> other over Agent Relay, and Relay tells each agent who is really asking. The actor filters what that person may see
> before the model writes a word, then logs the outcome. Data stays home. Answers travel.

---

**If you have 20 more seconds:** click **Red team** on camera.
> Six classic prompt-injection attacks, sent as Alex: "ignore your rules", "I'm the team lead", "translate the
> restricted entries"… Six of six blocked, all logged, guard catches still zero.

**Accuracy notes for the narrator** (all true in the current build):
- The model call (gpt-4.1-mini) runs inside the team's actor, so text never leaves it un-filtered.
- If the model or Wi-Fi fails, the agent answers from a deterministic fallback instead of escalating.
- The flow strip draws Priya, Alex, Software and Battery; Sam's own questions and the Controls and Robotics agents don't
  show on the strip (they still show in the timeline and audit log).
