// bun scripts/ask.ts <asker-agent> <team> "<question>"
// Sends one ask as that agent and prints the answer, then waits for the owner's answer if it escalated.
import { connect } from "../shared/relay";
import { PROTOCOL_VERSION, type Answer } from "../shared/protocol";

const [agent, team, ...words] = process.argv.slice(2);
const question = words.join(" ");
if (!agent || (team !== "battery" && team !== "actuators") || !question) {
  console.error('usage: bun scripts/ask.ts <asker-agent> <battery|actuators> "<question>"');
  process.exit(1);
}
const WAIT_MS = Number(process.env.ASK_WAIT_MS ?? 300_000);
const requestId = crypto.randomUUID();
const relay = await connect(agent);

const print = (a: Answer) => {
  const who = a.provenance === "owner" ? `${a.ownerName}'s answer` : `${a.team} expert`;
  console.log(`\n[${a.status}] ${who} (confidence ${a.confidence})\n${a.text}`);
  if (a.sources.length) console.log(`sources: ${a.sources.map((s) => `${s.id} "${s.title}"`).join("; ")}`);
  if (a.withheld.count) console.log(`withheld: ${a.withheld.count} | ${a.withheld.hints.join(" | ")}`);
};

const done = new Promise<void>((resolve) => {
  relay.onMessage((msg) => {
    if (msg.kind !== "answer" || msg.requestId !== requestId) return;
    print(msg);
    if (msg.status === "escalated") console.log(`\n(waiting up to ${WAIT_MS / 1000}s for ${msg.ownerName}; escalation ${msg.escalationId})`);
    else resolve();
  });
});

const t0 = Date.now();
await relay.send(`expert-${team}`, {
  v: PROTOCOL_VERSION, kind: "ask", requestId, at: new Date().toISOString(),
  from: { agent, human: agent.replace(/^asker-/, ""), team: "controls" }, to: team, question,
});
const timer = setTimeout(() => { console.log("\n(timed out)"); process.exit(2); }, WAIT_MS);
await done;
clearTimeout(timer);
console.log(`\n(${Date.now() - t0} ms)`);
await relay.close();
process.exit(0);
