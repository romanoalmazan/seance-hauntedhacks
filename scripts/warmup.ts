// bun scripts/warmup.ts — one real model call per expert, through the actor, so the first demo answer
// isn't the slow one (cold actor + first TLS handshake to the model API). Run it after scripts/demo.sh
// and BEFORE pressing Reset: it leaves one audit entry per team, which Reset (or the reset below) clears.
import { expert, expertAgent, feed } from "../shared/actors";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { TeamId } from "../shared/types";

const QUESTIONS: Record<TeamId, string> = {
  battery: "What current can the pack deliver?",
  actuators: "What peak current can ACT-7 draw?",
  software: "What format does the X database need?",
};

for (const team of Object.keys(QUESTIONS) as TeamId[]) {
  const t = Date.now();
  const r = await expertAgent(team).ask("warmup", {
    v: PROTOCOL_VERSION, kind: "ask", requestId: `warmup-${crypto.randomUUID()}`, at: new Date().toISOString(),
    from: { agent: "warmup", human: "warmup", team: "ops" }, to: team, question: QUESTIONS[team],
  });
  console.log(`${team}: ${r.answer.status} in ${Date.now() - t} ms`);
}
await Promise.all([expert("battery").reset(), expert("actuators").reset(), feed().reset()]);
console.log("Warm. Experts and feed reset. Now press Reset on the console.");
