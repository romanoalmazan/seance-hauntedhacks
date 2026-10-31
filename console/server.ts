// Owner console server. The page polls; there is no WebSocket.
// Run: npx bun console/server.ts
import { z } from "zod";
import { createFakes, type DevHooks } from "./fakes";
import type { ConsoleActorApi, FeedApi, TeamId } from "../shared/types";

const PORT = 3000;
// /snapshot carries restricted text and nothing here is authenticated, so stay on loopback.
const HOSTNAME = "127.0.0.1";
const FEED_LIMIT = 100;
const TEAMS: readonly TeamId[] = ["battery", "actuators"];

export interface ConsoleDeps {
  expert(team: TeamId): ConsoleActorApi;
  feed(): FeedApi;
  /** Only the fakes supply this, so /dev/event does not exist against real actors. */
  dev?: DevHooks;
}

const devEventSchema = z.object({
  time: z.string().datetime().optional(),
  team: z.enum(["battery", "actuators"]),
  asker: z.string().min(1),
  question: z.string().min(1),
  decision: z.enum(["answered", "partial", "refused", "escalated", "guard_blocked", "learned"]),
  repeat: z.boolean().optional(),
});

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: "not found" }, 404);

function isTeam(value: string | undefined): value is TeamId {
  return TEAMS.includes(value as TeamId);
}

async function devEvent(req: Request, dev: DevHooks): Promise<Response> {
  const parsed = devEventSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid event" }, 400);
  const { repeat, time, ...event } = parsed.data;
  await dev.event({ ...event, time: time ?? new Date().toISOString() }, { repeat });
  return json({ ok: true });
}

export function handler(deps: ConsoleDeps) {
  async function route(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (req.method === "GET") {
      if (pathname === "/") return new Response(Bun.file(`${import.meta.dir}/index.html`));
      if (pathname === "/feed") return json(await deps.feed().recent(FEED_LIMIT));
      const team = pathname.match(/^\/snapshot\/([^/]+)$/)?.[1];
      if (isTeam(team)) return json(await deps.expert(team).snapshot());
    }

    if (req.method === "POST") {
      if (pathname === "/reset") {
        await Promise.all([...TEAMS.map((team) => deps.expert(team).reset()), deps.feed().reset()]);
        return json({ ok: true });
      }
      if (pathname === "/dev/event" && deps.dev) return devEvent(req, deps.dev);
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
