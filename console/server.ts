// Owner console server. The page polls; there is no WebSocket.
// Run: npx bun console/server.ts
import { z } from "zod";
import { createCards, ownerReplyInput } from "./escalations";
import { createFakes, type DevHooks } from "./fakes";
import type { RelayClient } from "../shared/protocol";
import type { ConsoleActorApi, FeedApi, TeamId } from "../shared/types";

const PORT = 3000;
// /snapshot carries restricted text and nothing here is authenticated, so stay on loopback.
const HOSTNAME = "127.0.0.1";
const FEED_LIMIT = 100;
const TEAMS: readonly TeamId[] = ["battery", "actuators"];

export interface ConsoleDeps {
  expert(team: TeamId): ConsoleActorApi;
  feed(): FeedApi;
  /** Connected as agent `console`. */
  relay: RelayClient;
  /** Only the fakes supply this, so the /dev routes do not exist against real actors. */
  dev?: DevHooks;
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

export function handler(deps: ConsoleDeps) {
  const cards = createCards(deps.relay, deps.expert);

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
      if (pathname === "/cards") return json(cards.list());
      const team = pathname.match(/^\/snapshot\/([^/]+)$/)?.[1];
      if (isTeam(team)) return json(await deps.expert(team).snapshot());
    }

    if (req.method === "POST") {
      if (pathname === "/reset") {
        await Promise.all([...TEAMS.map((team) => deps.expert(team).reset()), deps.feed().reset()]);
        cards.clear();
        return json({ ok: true });
      }
      if (pathname === "/owner-reply") return ownerReply(req);
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

if (import.meta.main) {
  const server = Bun.serve({ port: PORT, hostname: HOSTNAME, fetch: handler(createFakes()) });
  console.log(`Owner console on ${server.url} (fakes)`);
}
