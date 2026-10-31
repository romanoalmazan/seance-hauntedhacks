// Pure rules for the console's flow strip. The server hands this file to the page as /flow.js, and
// the drawing code in index.html does the lighting. Node ids are Relay agent names, plus two below.
import type { FeedEvent } from "../shared/types";

export const RELAY = "relay";
export const CONSOLE = "console";

export interface Edge {
  from: string;
  to: string;
}

type Flowing = Pick<FeedEvent, "team" | "asker" | "decision">;

const expertOf = (team: FeedEvent["team"]) => `expert-${team}`;

/** Every hop passes through Relay, so a consult (asker `expert-*`) needs no case of its own. */
function hops(...nodes: string[]): Edge[] {
  return nodes.slice(1).map((to, index) => ({ from: nodes[index]!, to }));
}

/** The ordered hops one feed event lights. */
export function flowEdges({ team, asker, decision }: Flowing): Edge[] {
  const expert = expertOf(team);
  if (decision === "learned") return hops(CONSOLE, RELAY, expert, RELAY, asker);
  const exchange = hops(asker, RELAY, expert, RELAY, asker);
  return decision === "escalated" ? [...exchange, ...hops(expert, RELAY, CONSOLE)] : exchange;
}

/** The expert to draw in the refused color, if any. */
export function refusedNode({ team, decision }: Flowing): string | null {
  return decision === "refused" || decision === "guard_blocked" ? expertOf(team) : null;
}

/** One line: who started the exchange, who received it, how it ended. */
export function flowCaption(event: Flowing): string {
  const from = event.decision === "learned" ? CONSOLE : event.asker;
  return `${from} to ${expertOf(event.team)}: ${event.decision.replace("_", " ")}`;
}

/** Team and decision join time, asker and question: a two-team ask can share a millisecond. */
export function eventKey({ time, team, asker, question, decision }: FeedEvent): string {
  return JSON.stringify([time, team, asker, question, decision]);
}
