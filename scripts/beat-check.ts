// bun scripts/beat-check.ts  — runs beats 1, 2, 2½, 3 (+ replay) against the running stack and
// prints PASS/FAIL per beat. Needs: Relay engine, Terse dev server, both bridges.
// Beat 2½ kills the actuators bridge and restarts it (logs to bridge-actuators.log).
// Resets both experts and the feed first. Run it with the asker and console servers stopped: they also
// connect as asker-priya / asker-guest / console and take the answers and notices.
import { connect } from "../shared/relay";
import { expert, feed } from "../shared/actors";
import { PROTOCOL_VERSION, type Answer, type RelayClient } from "../shared/protocol";

const REGEN = "Does ACT-7 support regenerative braking into the pack?";
const MARCUS = "Yes, up to 15 A regen. The BMS must be in a charge-enabled state, so check with Battery first.";
const BEAT1 = "I'm setting current limits for the ACT-7 controller. What peak current can I draw, and for how long?";
const results: [string, boolean, string][] = [];
const check = (beat: string, ok: boolean, detail: string) => { results.push([beat, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${beat}: ${detail}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const inbox = new Map<string, Answer[]>();
async function asker(agent: string): Promise<RelayClient> {
  const c = await connect(agent);
  c.onMessage((m) => { if (m.kind === "answer") inbox.set(m.requestId, [...(inbox.get(m.requestId) ?? []), m]); });
  return c;
}
async function waitFor(requestId: string, n: number, ms = 20_000): Promise<Answer[]> {
  const end = Date.now() + ms;
  while (Date.now() < end && (inbox.get(requestId)?.length ?? 0) < n) await sleep(50);
  return inbox.get(requestId) ?? [];
}
function ask(c: RelayClient, team: "battery" | "actuators", question: string, requestId: string = crypto.randomUUID()) {
  return c.send(`expert-${team}`, {
    v: PROTOCOL_VERSION, kind: "ask", requestId, at: new Date().toISOString(),
    from: { agent: c.agent, human: c.agent, team: "controls" }, to: team, question,
  }).then(() => requestId);
}
async function ownerReply(c: RelayClient, escalationId: string) {
  await c.send("expert-actuators", {
    v: PROTOCOL_VERSION, kind: "owner_reply", requestId: crypto.randomUUID(), at: new Date().toISOString(),
    escalationId, ownerName: "Marcus", text: MARCUS, save: true, sensitivity: "public", tags: ["regen", "braking"],
  });
}

await Promise.all([expert("battery").reset(), expert("actuators").reset(), feed().reset()]);
const priya = await asker("asker-priya");
const guest = await asker("asker-guest");
const consoleC = await connect("console");
const notices: string[] = [];
consoleC.onMessage((m) => { if (m.kind === "escalation_notice") notices.push(m.escalation.id); });

// Beat 1
{
  const [a, b] = await Promise.all([ask(priya, "actuators", BEAT1), ask(priya, "battery", BEAT1)]);
  const [ra, rb] = [(await waitFor(a, 1))[0], (await waitFor(b, 1))[0]];
  const ok = ra?.status === "answered" && rb?.status === "answered" && !!ra.sources.length && !!rb.sources.length;
  check("1 instant cross-team answer", ok, `actuators=${ra?.status} [${ra?.sources.map((s) => s.id)}], battery=${rb?.status} [${rb?.sources.map((s) => s.id)}]`);
}

// Beat 2 + 2½: escalate, kill bridge, owner replies while it's down, restart, Priya still gets it
let escId = "";
{
  const id = await ask(priya, "actuators", REGEN);
  const first = (await waitFor(id, 1))[0];
  await sleep(500);
  escId = first?.escalationId ?? "";
  check("2 escalates", first?.status === "escalated" && notices.includes(escId), `status=${first?.status}, notice to console=${notices.includes(escId)}`);

  Bun.spawnSync(["pkill", "-f", "expert-bridge.ts actuators"]);
  await sleep(500);
  await ownerReply(consoleC, escId);
  await sleep(1000);
  const before = (inbox.get(id) ?? []).length;
  Bun.spawnSync(["sh", "-c", "nohup bun bridge/expert-bridge.ts actuators >> bridge-actuators.log 2>&1 &"]);
  const all = await waitFor(id, 2, 15_000);
  const owner = all.find((x) => x.provenance === "owner");
  check("2½ survives bridge restart", before === 1 && owner?.status === "answered" && owner.text === MARCUS,
    `answers before restart=${before}, owner answer after=${owner ? `${owner.ownerName}: answered` : "none"}`);
}

// Beat 3
{
  const snap0 = await expert("actuators").snapshot();
  const r = (await waitFor(await ask(guest, "actuators", REGEN), 1))[0];
  const snap1 = await expert("actuators").snapshot();
  const p = (await waitFor(await ask(guest, "battery", "What current can the pack deliver?"), 1))[0];
  check("3a learned answer reused", r?.status === "answered" && r.sources.some((s) => s.id.includes("-L")) && snap1.stats.repeatsServed === snap0.stats.repeatsServed + 1,
    `status=${r?.status} sources=[${r?.sources.map((s) => s.id)}] repeatsServed ${snap0.stats.repeatsServed}->${snap1.stats.repeatsServed}`);
  check("3b pack answer by clearance", p?.status === "partial" && p.sources.map((s) => s.id).join() === "bat-01" && p.withheld.hints.some((h) => /derates/.test(h)),
    `status=${p?.status} sources=[${p?.sources.map((s) => s.id)}] hints=${JSON.stringify(p?.withheld.hints)}`);
}

// Replay: same ask delivered twice is handled once
{
  const rid = crypto.randomUUID();
  const s0 = (await expert("battery").snapshot()).stats.asked;
  await ask(guest, "battery", "What current can the pack deliver?", rid);
  await ask(guest, "battery", "What current can the pack deliver?", rid);
  await sleep(2000);
  const s1 = (await expert("battery").snapshot()).stats.asked;
  check("replay handled once", s1 - s0 === 1 && (inbox.get(rid)?.length ?? 0) === 1, `asked +${s1 - s0}, answers=${inbox.get(rid)?.length ?? 0}`);
}

await Promise.all([priya.close(), guest.close(), consoleC.close()]);
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
