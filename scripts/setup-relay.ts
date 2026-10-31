// Create (or reuse) the Relay workspace and register the five Séance agents.
// Idempotent: tokens are saved to the gitignored .relay-tokens.json and reused on re-run.
// Usage: bun scripts/setup-relay.ts   (engine must be running; see docs/spike-notes.md ## S2)
import { RelayCast } from "@relaycast/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const AGENTS = ["expert-battery", "expert-actuators", "expert-software", "asker-priya", "asker-robotics", "asker-guest", "console"] as const;
const TOKENS_PATH = resolve(import.meta.dir, "..", ".relay-tokens.json");
const baseUrl = process.env.RELAY_BASE_URL || "http://localhost:8787";

type TokenFile = { baseUrl: string; workspaceKey: string; agents: Record<string, string> };

function load(): TokenFile | null {
  if (!existsSync(TOKENS_PATH)) return null;
  try { return JSON.parse(readFileSync(TOKENS_PATH, "utf8")); } catch { return null; }
}

async function workspaceWorks(key: string): Promise<boolean> {
  try { await new RelayCast({ apiKey: key, baseUrl }).agents.list(); return true; } catch { return false; }
}

const saved = load();
let workspaceKey = "";
let agents: Record<string, string> = {};
for (const candidate of [process.env.RELAY_WORKSPACE_KEY, saved?.workspaceKey]) {
  if (candidate && (await workspaceWorks(candidate))) { workspaceKey = candidate; break; }
}
if (workspaceKey && saved?.workspaceKey === workspaceKey) agents = { ...saved.agents };
if (!workspaceKey) {
  const ws = await RelayCast.createWorkspace(`seance-${Date.now()}`, { baseUrl } as any);
  workspaceKey = ws.apiKey;
  agents = {};
  console.log("created new workspace");
} else {
  console.log("reusing workspace");
}

const relay = new RelayCast({ apiKey: workspaceKey, baseUrl });
for (const name of AGENTS) {
  if (agents[name]) {
    try { await relay.as(agents[name]).me(); console.log(`  ${name}: reused token`); continue; }
    catch { console.log(`  ${name}: saved token rejected, re-registering`); }
  }
  try {
    const { token } = await relay.agents.register({ name, type: "agent" });
    agents[name] = token;
    console.log(`  ${name}: registered`);
  } catch (e: any) {
    if (e?.status === 409 || /already exists/i.test(String(e?.message))) {
      throw new Error(`${name} exists in this workspace but its token is not saved. ` +
        `Delete .relay-tokens.json (and unset RELAY_WORKSPACE_KEY) to make a fresh workspace.`);
    }
    throw e;
  }
}

const out: TokenFile = { baseUrl, workspaceKey, agents };
writeFileSync(TOKENS_PATH, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
console.log(`saved ${Object.keys(agents).length} agent tokens to .relay-tokens.json (baseUrl ${baseUrl})`);
process.exit(0);
