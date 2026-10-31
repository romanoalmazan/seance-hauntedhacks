// bun scripts/preflight.ts — run right before going on stage (after scripts/demo.sh, warmup, Reset).
// One line per check, green ok / red FAIL; exits 1 on any red.
import { statSync } from "node:fs";
import { expert, feed } from "../shared/actors";
import type { TeamId } from "../shared/types";

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", OFF = "\x1b[0m";
let red = 0;
const ok = (msg: string) => console.log(`${GREEN}  ok  ${OFF}${msg}`);
const bad = (msg: string) => { red++; console.log(`${RED} FAIL ${OFF}${msg}`); };
const note = (msg: string) => console.log(`${DIM}  --  ${msg}${OFF}`);
const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd]).stdout.toString().trim();
const env = process.env; // Bun loads .env

// 1. Ports up and bound to localhost only
const PORTS: [number, string][] = [[8787, "Relay engine"], [7100, "Terse dev server"], [3000, "console"], [3001, "Priya asker"], [3002, "Robotics asker"], [3003, "Sam asker"]];
for (const [port, name] of PORTS) {
  const addrs = sh(`lsof -nP -iTCP:${port} -sTCP:LISTEN | awk 'NR>1 {print $9}' | sort -u`).split("\n").filter(Boolean);
  if (!addrs.length) bad(`${name} :${port} is not listening`);
  else if (addrs.every((a) => a.startsWith("127.0.0.1:") || a.startsWith("[::1]:"))) ok(`${name} :${port} on ${addrs.join(", ")}`);
  else bad(`${name} :${port} listens on ${addrs.join(", ")} (want 127.0.0.1 only)`);
}

// 2. Bridges running and listening (and consulting, when CONSULT=1)
for (const team of ["software", "battery", "actuators"] as TeamId[]) {
  const running = sh(`pgrep -f "expert-bridge.ts ${team}"`);
  const last = sh(`grep listening bridge-${team}.log 2>/dev/null | tail -1`);
  if (!running) bad(`${team} bridge is not running`);
  else if (!last) bad(`${team} bridge running but bridge-${team}.log has no "listening" line`);
  else if (team === "actuators" && env.CONSULT === "1" && !last.includes("consults battery"))
    bad(`actuators bridge is not consulting, but CONSULT=1 in .env: restart it`);
  else ok(`${team} bridge listening${team === "actuators" ? (last.includes("consults battery") ? " (consults battery)" : " (no consult)") : ""}`);
}

// 3 + 4. Model configured and fast
if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) {
  bad(`OPENAI_API_KEY / OPENAI_MODEL not set in .env`);
  note("model check skipped: no key. The experts will use the deterministic drafter.");
} else {
  ok(`OPENAI_MODEL=${env.OPENAI_MODEL}, key set`);
  const t = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(3000),
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: env.OPENAI_MODEL, max_completion_tokens: 5, messages: [{ role: "user", content: "Say ok." }] }),
    });
    const ms = Date.now() - t;
    if (!res.ok) bad(`model call returned HTTP ${res.status} in ${ms} ms`);
    else if (ms >= 3000) bad(`model call took ${ms} ms (want < 3000)`);
    else ok(`model call ${ms} ms`);
  } catch (e) {
    bad(`model call failed in ${Date.now() - t} ms: ${(e as Error).message}`);
  }
}

// 5. Experts and feed empty (Reset pressed)
for (const team of ["software", "battery", "actuators"] as TeamId[]) {
  try {
    const s = await expert(team).snapshot();
    const dirty = [
      s.audit.length && `${s.audit.length} audit events`,
      s.pending.length && `${s.pending.length} escalations`,
      Object.values(s.stats).some((n) => n !== 0) && `stats ${JSON.stringify(s.stats)}`,
      s.knowledge.some((e) => e.source === "owner_answer") && "learned entries",
    ].filter(Boolean);
    if (dirty.length) bad(`${team} expert not reset: ${dirty.join(", ")} (press Reset)`);
    else ok(`${team} expert reset`);
  } catch (e) {
    bad(`${team} expert unreachable: ${(e as Error).message}`);
  }
}
try {
  const n = (await feed().recent(5)).length;
  n ? bad(`feed has ${n}+ events (press Reset)`) : ok("feed empty");
} catch (e) {
  bad(`feed unreachable: ${(e as Error).message}`);
}

// 6. .env not readable by other users
try {
  const mode = statSync(".env").mode & 0o777;
  if (mode & 0o044) bad(`.env is mode ${mode.toString(8)}: readable by other users (chmod 600 .env)`);
  else ok(`.env mode ${mode.toString(8)}`);
} catch {
  bad(".env missing");
}

console.log(red ? `\n${RED}${red} check(s) failed${OFF}` : `\n${GREEN}All green.${OFF}`);
process.exit(red ? 1 : 0);
