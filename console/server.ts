// Owner console server. The page polls; there is no WebSocket.
// Run: bun console/server.ts. REAL=1 uses the real actors and Relay (see docs/RUNBOOK.md); otherwise fakes.
import { z } from "zod";
import { createCards, ownerReplyInput, TEAMS } from "./escalations";
import { createFakes, type DevHooks } from "./fakes";
import { askGuest, redteam } from "../scripts/redteam";
import type { RelayClient } from "../shared/protocol";
import type { ConsoleActorApi, FeedApi, TeamId } from "../shared/types";

const PORT = 3000;
// /snapshot carries restricted text and nothing here is authenticated, so stay on loopback.
const HOSTNAME = "127.0.0.1";
const FEED_LIMIT = 100;
// Must outlast POST /redteam, or Bun drops it mid-run (default 10 s): six asks at the asker's 30 s
// timeout each.
const IDLE_TIMEOUT_SECONDS = 190;
const ASKER_URLS = { "asker-priya": "http://127.0.0.1:3001", "asker-guest": "http://127.0.0.1:3002" };
const ASKER_RESET_TIMEOUT_MS = 2000;

export interface ConsoleDeps {
  expert(team: TeamId): ConsoleActorApi;
  feed(): FeedApi;
  /** Connected as agent `console`. */
  relay: RelayClient;
  /** Only the fakes supply this, so the /dev routes do not exist against real actors. */
  dev?: DevHooks;
  /** Sends one chat line as Guest. Defaults to the Guest asker's POST /ask. */
  askGuest?(text: string): Promise<string>;
  /** Clears both chat pages and returns the askers it missed. Defaults to their POST /reset. */
  resetAskers?(): Promise<string[]>;
}

const devEventSchema = z.object({
  time: z.string().datetime().optional(),
  team: z.enum(["battery", "actuators"]),
  asker: z.string().min(1),
  question: z.string().min(1),
  decision: z.enum(["answered", "partial", "refused", "escalated", "guard_blocked", "learned"]),
  repeat: z.boolean().optional(),
  entriesUsed: z.array(z.string()).optional(),
  entriesWithheld: z.array(z.string()).optional(),
  leakPrevented: z.boolean().optional(),
});

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: "not found" }, 404);

function isTeam(value: string | undefined): value is TeamId {
  return TEAMS.includes(value as TeamId);
}

async function devEvent(req: Request, dev: DevHooks): Promise<Response> {
  const parsed = devEventSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid event" }, 400);
  const { time, team, asker, question, decision, ...options } = parsed.data;
  await dev.event({ time: time ?? new Date().toISOString(), team, asker, question, decision }, options);
  return json({ ok: true });
}

async function resetAskers(): Promise<string[]> {
  const missed = await Promise.all(
    Object.entries(ASKER_URLS).map(async ([agent, url]) => {
      const reset = fetch(`${url}/reset`, { method: "POST", signal: AbortSignal.timeout(ASKER_RESET_TIMEOUT_MS) });
      return (await reset.then(({ ok }) => ok, () => false)) ? [] : [agent];
    }),
  );
  return missed.flat();
}

export function handler(deps: ConsoleDeps) {
  const cards = createCards(deps.relay, deps.expert);
  cards.reconcile().catch((error) => console.warn("[console] startup reconcile failed:", error));

  async function ownerReply(req: Request): Promise<Response> {
    const parsed = ownerReplyInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid reply" }, 400);
    const result = await cards.reply(parsed.data);
    if (result === "gone") return json({ error: "no open escalation" }, 404);
    if (result === "busy") return json({ error: "already sending" }, 409);
    return json({ ok: true });
  }

  async function route(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (req.method === "GET") {
      if (pathname === "/") return new Response(Bun.file(`${import.meta.dir}/index.html`));
      if (pathname === "/feed") return json(await deps.feed().recent(FEED_LIMIT));
      if (pathname === "/cards") {
        await cards.reconcile();
        return json(cards.list());
      }
      const team = pathname.match(/^\/snapshot\/([^/]+)$/)?.[1];
      if (isTeam(team)) return json(await deps.expert(team).snapshot());
    }

    if (req.method === "POST") {
      if (pathname === "/reset") {
        await Promise.all([...TEAMS.map((team) => deps.expert(team).reset()), deps.feed().reset()]);
        cards.clear();
        // The actors are reset by now, so a chat page left uncleared is reported, not a failure.
        return json({ ok: true, missed: await (deps.resetAskers ?? resetAskers)() });
      }
      if (pathname === "/owner-reply") return ownerReply(req);
      if (pathname === "/redteam") {
        return json(
          await redteam({
            ask: deps.askGuest ?? askGuest,
            audit: async (team) => (await deps.expert(team).snapshot()).audit,
          }),
        );
      }
      if (pathname === "/dev/event" && deps.dev) return devEvent(req, deps.dev);
      if (pathname === "/dev/escalate" && deps.dev) {
        return json({ ok: true, escalationId: await deps.dev.escalate() });
      }
    }

    return notFound();
  }

  return async (req: Request): Promise<Response> => {
    try {
      return await route(req);
    } catch (error) {
      console.error(`${req.method} ${req.url} failed:`, error);
      return json({ error: "server error" }, 500);
    }
  };
}

/** No `dev` here, so the /dev routes don't exist against the real stack. */
async function realDeps(): Promise<ConsoleDeps> {
  const { connect } = await import("../shared/relay");
  const { expert, feed } = await import("../shared/actors");
  return { expert, feed, relay: await connect("console") };
}

if (import.meta.main) {
  const real = process.env.REAL === "1";
  const deps = real ? await realDeps() : createFakes();
  const server = Bun.serve({
    port: PORT,
    hostname: HOSTNAME,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    fetch: handler(deps),
  });
  console.log(`Owner console on ${server.url} (${real ? "real stack" : "fakes"})`);
}
