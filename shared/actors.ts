// Thin wrapper over the generated Terse client (actors/generated). Honors TERSE_ACTOR_URL and
// TERSE_API_KEY; with neither set it talks to the local dev server on 127.0.0.1:7100.
import { actors } from "../actors/generated/index.js";
import type { ConsoleActorApi, FeedApi, FeedEvent, TeamId } from "./types";
import type { Ask, OwnerReply } from "./protocol";
import type { AskResult, OwnerReplyResult } from "../actors/src/expert-logic";

export const FEED_ID = "main";

/** Console-facing calls only (the surfaces lane's view). */
export function expert(team: TeamId): ConsoleActorApi {
  const a = actors.ExpertAgent.get(team);
  return {
    snapshot: () => a.snapshot(),
    setSensitivity: (entryId, tier) => a.setSensitivity(entryId, tier),
    setClearance: (agent, level) => a.setClearance(agent, level),
    reset: () => a.reset(),
  };
}

export function feed(): FeedApi & { push(e: FeedEvent): Promise<void> } {
  const f = actors.Feed.get(FEED_ID);
  return {
    recent: (n) => f.recent(n),
    reset: () => f.reset(),
    push: (e) => f.push(e),
  };
}

/** Bridge-only calls. `sender` must be the Relay-stamped agent name. */
export function expertAgent(team: TeamId): ConsoleActorApi & {
  ask(sender: string, ask: Ask): Promise<AskResult>;
  ownerReply(reply: OwnerReply): Promise<OwnerReplyResult>;
} {
  const a = actors.ExpertAgent.get(team);
  return { ...expert(team), ask: (sender, ask) => a.ask(sender, ask), ownerReply: (r) => a.ownerReply(r) };
}
