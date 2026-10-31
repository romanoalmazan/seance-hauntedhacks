# Console voice-over (about 1 minute)

Record http://127.0.0.1:3000 right after the demo. Don't press Reset first.

**[Counters]**
> Behind the demo: questions answered without bothering Sam, one refused, and zero guard catches. Restricted text never reached the model.

**[How a question travels]** (point left to right)
> Each person has their own agent. Agents never call each other directly: every question is a direct message through Agent Relay, which stamps who sent it. That's how Sam's agent knows it's Romano asking, not someone claiming to be. The last exchange lights up live: here, Justin's question to the Software agent, refused in red.

**[Inside each Terse Durable Actor]**
> Each team agent is a Terse Durable Actor: the only place that team's knowledge lives. Software holds sof-T1, the X database format. It's shared with Controls, not Robotics, so Justin was refused before the model was ever called. Every decision lands in the actor's audit log, and it all survives restarts.

**[Audit log]**
> Sam taught it, Romano got it, Justin was refused, then answered once Sam shared.

**[Close]**
> Data stays home in Terse. Answers travel over Agent Relay.
