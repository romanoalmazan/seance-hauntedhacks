// One process per asker: `bun asker/server.ts asker-robotics`, or set ASKER_AGENT. Default asker-priya.
// REAL=1 uses the real Relay (see docs/RUNBOOK.md); otherwise the in-memory fake.
import { z } from "zod";
import { fakeConnect } from "../shared/fakes";
import { createAsker, parseMentions } from "./asker-agent";
import type { AskerIdentity } from "./asker-agent";
import { DIRECTORY } from "./directory";
import type { TeamId } from "../shared/types";
import { eventStream } from "./events";

// `owns`: this person also runs a team's expert. A message to their own agent with no @team is
// them telling it something (saved via the console's /teach), and they choose who may ask.
const ASKERS: Record<string, { port: number; owns?: TeamId } & AskerIdentity> = {
  "asker-priya": { agent: "asker-priya", human: "Priya Raman", team: "Controls", port: 3001, owns: "controls" },
  "asker-robotics": { agent: "asker-robotics", human: "Alex Chen", team: "Robotics", port: 3002, owns: "robotics" },
  "asker-sam": { agent: "asker-sam", human: "Sam Patel", team: "Software", port: 3003, owns: "software" },
};

const agent = process.argv[2] ?? process.env.ASKER_AGENT ?? "asker-priya";
const config = ASKERS[agent];
if (!config) {
  console.error(`Unknown asker ${agent}. Use one of: ${Object.keys(ASKERS).join(", ")}`);
  process.exit(1);
}
const { port, owns, ...identity } = config;
const CONSOLE = "http://127.0.0.1:3000";
// Who belongs to which team, for "Share agent context": each owner shares with the other teams.
const GROUPS = { software: "asker-sam", controls: "asker-priya", robotics: "asker-robotics" } as const;
type Group = keyof typeof GROUPS;
const GROUP_LABELS: Record<Group, string> = { software: "Software team", controls: "Controls team", robotics: "Robotics company" };
const shareBody = z.object({ group: z.enum(["software", "controls", "robotics"]), allowed: z.boolean() });
const otherGroups = () => (Object.keys(GROUPS) as Group[]).filter((g) => g !== owns);

/** "topic: details" -> title + text; without a colon the first words are the title. */
function splitTeach(input: string): { title: string; text: string } {
  const i = input.indexOf(":");
  if (i > 2 && i < 120) return { title: input.slice(0, i).trim(), text: input.slice(i + 1).trim() };
  return { title: input.trim().split(/\s+/).slice(0, 8).join(" "), text: input.trim() };
}

async function consoleJson(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${CONSOLE}${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `console ${res.status}`);
  return json;
}

const real = process.env.REAL === "1";
// Imported only when asked for, so the fake needs neither the SDK nor .relay-tokens.json.
const connect = real ? (await import("../shared/relay")).connect : fakeConnect;
const asker = await createAsker(identity, connect);

const askBody = z.object({ text: z.string().min(1), context: z.string().optional() });

const server = Bun.serve({
  port,
  // The port is the identity and there is no login, so keep it off the venue network.
  hostname: "127.0.0.1",
  // Must outlast the asker's answer timeout, or Bun drops POST /ask while it waits (default 10 s).
  idleTimeout: 60,
  routes: {
    "/": () => new Response(Bun.file(`${import.meta.dir}/chat.html`)),
    "/directory": () => Response.json({ me: { ...identity, owns: owns ?? null }, teams: DIRECTORY.filter((t) => !t.hidden && t.teamId !== owns) }),
    // "Share agent context": which teams may ask this person's own expert.
    "/share": {
      async GET() {
        if (!owns) return Response.json({ error: "this person runs no team expert" }, { status: 404 });
        const snap = await consoleJson(`/snapshot/${owns}`);
        const level = (agent: string) => snap.policy.clearance[agent] ?? snap.policy.defaultClearance;
        return Response.json(otherGroups().map((g) => ({ group: g, label: GROUP_LABELS[g], allowed: level(GROUPS[g]) >= 1 })));
      },
      async POST(req) {
        if (!owns) return Response.json({ error: "this person runs no team expert" }, { status: 404 });
        const body = shareBody.safeParse(await req.json().catch(() => null));
        if (!body.success || body.data.group === owns) return Response.json({ error: "Send JSON: { group, allowed }" }, { status: 400 });
        await consoleJson("/team-access", { team: owns, ...body.data });
        return Response.json({ ok: true });
      },
    },
    "/events": () => eventStream(asker),
    "/ask": {
      async POST(req) {
        const body = askBody.safeParse(await req.json().catch(() => null));
        if (!body.success) {
          return Response.json({ error: "Send JSON: { text, context? }" }, { status: 400 });
        }
        const text = body.data.text;
        const mentions = parseMentions(text);
        if (owns && !/^\s*\/raw/i.test(text) && mentions.teams.length === 0 && mentions.unknown.length === 0) {
          // No @team: the owner is telling their own agent something.
          const { title, text: details } = splitTeach(text);
          try {
            const { id } = await consoleJson("/teach", { team: owns, title, text: details });
            const note = `Got it. I saved "${title}" as ${id}. Use Share agent context to choose which teams can ask me about it.`;
            return Response.json({ text: note, asks: [], notice: null });
          } catch (err) {
            return Response.json({ text: `I couldn't save that: ${(err as Error).message}`, asks: [], notice: null });
          }
        }
        return Response.json(await asker.ask(text, body.data.context));
      },
    },
    // The console's Reset calls this to clear the chat page.
    "/reset": {
      POST() {
        asker.reset();
        return Response.json({ ok: true });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
  error(err) {
    console.error(`[${agent}]`, err);
    return Response.json({ error: "The asker hit an error. See its log." }, { status: 500 });
  },
});

console.log(`${agent} (${identity.human}) on ${server.url} using the ${real ? "real" : "fake"} Relay`);
