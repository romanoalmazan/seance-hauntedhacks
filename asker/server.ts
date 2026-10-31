// One process per asker: `npx bun asker/server.ts asker-guest`, or set ASKER_AGENT. Default asker-priya.
import { z } from "zod";
import { fakeConnect } from "../shared/fakes";
import { createAsker } from "./asker-agent";
import type { AskerIdentity } from "./asker-agent";
import { DIRECTORY } from "./directory";
import { eventStream } from "./events";

const ASKERS: Record<string, { port: number } & AskerIdentity> = {
  "asker-priya": { agent: "asker-priya", human: "Priya Raman", team: "Controls", port: 3001 },
  "asker-guest": { agent: "asker-guest", human: "Guest", team: "Outside contractor", port: 3002 },
};

const agent = process.argv[2] ?? process.env.ASKER_AGENT ?? "asker-priya";
const config = ASKERS[agent];
if (!config) {
  console.error(`Unknown asker ${agent}. Use one of: ${Object.keys(ASKERS).join(", ")}`);
  process.exit(1);
}
const { port, ...identity } = config;

const asker = await createAsker(identity, fakeConnect);

const askBody = z.object({ text: z.string().min(1), context: z.string().optional() });

const server = Bun.serve({
  port,
  // The port is the identity and there is no login, so keep it off the venue network.
  hostname: "127.0.0.1",
  // Must outlast the asker's answer timeout, or Bun drops POST /ask while it waits (default 10 s).
  idleTimeout: 60,
  routes: {
    "/": () => new Response(Bun.file(`${import.meta.dir}/chat.html`)),
    "/directory": () => Response.json({ me: identity, teams: DIRECTORY }),
    "/events": () => eventStream(asker),
    "/ask": {
      async POST(req) {
        const body = askBody.safeParse(await req.json().catch(() => null));
        if (!body.success) {
          return Response.json({ error: "Send JSON: { text, context? }" }, { status: 400 });
        }
        return Response.json(await asker.ask(body.data.text, body.data.context));
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
  error(err) {
    console.error(`[${agent}]`, err);
    return Response.json({ error: "The asker hit an error. See its log." }, { status: 500 });
  },
});

console.log(`${agent} (${identity.human}) on ${server.url} using the fake Relay`);
