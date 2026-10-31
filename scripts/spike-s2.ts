// Spike S2: proves DM both ways, offline delivery after restart, and replay dedupe.
// Usage: bun scripts/spike-s2.ts   (engine running + bun scripts/setup-relay.ts done)
import { spawn, type Subprocess } from "bun";
import { connect } from "../shared/relay";
import type { Message } from "../shared/protocol";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const run = Date.now().toString(36);

const ask = (requestId: string, question: string): Message => ({
  v: 1, kind: "ask", requestId, at: now(),
  from: { agent: "asker-priya", human: "Priya", team: "actuators" }, to: "battery", question,
});
const answer = (requestId: string, provenance: "expert_agent" | "owner", status: any, text: string): Message => ({
  v: 1, kind: "answer", requestId, at: now(), team: "battery", status, text, confidence: 0.9,
  sources: [], withheld: { count: 0, hints: [], canRequestAccess: false }, provenance, ownerName: "Dana",
});

// ---- receiver mode: runs as expert-battery in a child process ----
if (process.argv[2] === "--receiver") {
  const c = await connect("expert-battery", { log: (s) => console.log(`[receiver] ${s}`) });
  c.onMessage(async (msg, { sender }) => {
    console.log(`[receiver] HANDLED ${msg.kind} ${msg.requestId} from=${sender}`);
    if (msg.kind === "ask") await c.send(sender, answer(msg.requestId, "expert_agent", "answered", `re: ${msg.question}`));
  });
  console.log("[receiver] ready");
  await new Promise(() => {});
}

// ---- driver ----
function startReceiver(): { proc: Subprocess; lines: string[] } {
  const lines: string[] = [];
  const proc = spawn(["bun", import.meta.path, "--receiver"], { stdout: "pipe", stderr: "inherit" });
  (async () => {
    const dec = new TextDecoder();
    for await (const chunk of proc.stdout as any) for (const l of dec.decode(chunk).split("\n")) if (l) { lines.push(l); console.log(l); }
  })();
  return { proc, lines };
}
async function waitFor(lines: string[], needle: string, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (lines.some((l) => l.includes(needle))) return true; await sleep(100); }
  return false;
}
const results: [string, boolean][] = [];
const check = (name: string, ok: boolean) => { results.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const asker = await connect("asker-priya", { log: (s) => console.log(`[asker] ${s}`) });
const askerGot: string[] = [];
asker.onMessage((m, { sender }) => { askerGot.push(`${m.kind}:${m.requestId}:${m.kind === "answer" ? m.provenance : ""}:${sender}`); console.log(`[asker] HANDLED ${m.kind} ${m.requestId} from=${sender}`); });

// 1. two agents DM each other
let r = startReceiver();
await waitFor(r.lines, "ready");
await sleep(500);
const r1 = `r1-${run}`;
await asker.send("expert-battery", ask(r1, "What is the pack voltage?"));
check("expert receives ask", await waitFor(r.lines, `HANDLED ask ${r1} from=asker-priya`));
const t0 = Date.now(); while (Date.now() - t0 < 5000 && !askerGot.some((x) => x.startsWith(`answer:${r1}`))) await sleep(100);
check("asker receives answer (sender=expert-battery)", askerGot.includes(`answer:${r1}:expert_agent:expert-battery`));

// 2. receiver stopped -> send -> restart -> delivered
r.proc.kill(); await r.proc.exited; console.log("-- receiver stopped --");
await sleep(500);
const r2 = `r2-${run}`;
await asker.send("expert-battery", ask(r2, "Sent while you were down"));
await sleep(1000);
r = startReceiver(); console.log("-- receiver restarted --");
check("offline message delivered after restart", await waitFor(r.lines, `HANDLED ask ${r2}`));
await sleep(1500);
check("old message r1 not re-handled after restart", !r.lines.some((l) => l.includes(`HANDLED ask ${r1}`)));

// 3. replay handled once: same logical message re-sent (new Relay id), plus invalid body
await asker.send("expert-battery", ask(r2, "Sent while you were down"));
await asker.send("expert-battery", ask(r2, "Sent while you were down"));
await sleep(1500);
check("replayed ask r2 handled exactly once", r.lines.filter((l) => l.includes(`HANDLED ask ${r2}`)).length === 1);

// 3b. two answers same requestId, different provenance: both handled; exact replay dropped
const exp = await connect("expert-actuators");
const r3 = `r3-${run}`;
await exp.send("asker-priya", answer(r3, "expert_agent", "escalated", "Escalated to owner"));
await exp.send("asker-priya", answer(r3, "owner", "answered", "Owner says 48V"));
await exp.send("asker-priya", answer(r3, "owner", "answered", "Owner says 48V"));
await sleep(1500);
check("escalated + owner answers both delivered, replay dropped",
  askerGot.filter((x) => x.startsWith(`answer:${r3}:`)).length === 2);

r.proc.kill(); await r.proc.exited;
await asker.close(); await exp.close();
console.log(`\n${results.filter(([, ok]) => ok).length}/${results.length} checks passed`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
