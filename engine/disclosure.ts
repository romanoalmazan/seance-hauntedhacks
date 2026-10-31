// Split retrieved entries by the asker's clearance (SPEC §6). Hidden entries contribute only their hint.
import type { Clearance, KnowledgeEntry, Policy, Tier } from "../shared/types.js";

export const TIER_RANK: Record<Tier, Clearance> = { public: 0, internal: 1, restricted: 2 };
import type { Scored } from "./retrieve.js";

export interface Disclosure {
  visible: KnowledgeEntry[];
  hidden: KnowledgeEntry[]; // stays inside the actor; never sent to the model or Relay
  hints: string[];
  withheldCount: number;
  topScore: number;
}

export function clearanceOf(agent: string, policy: Policy): Clearance {
  return policy.clearance[agent] ?? policy.defaultClearance;
}

export function canSee(entry: KnowledgeEntry, clearance: Clearance): boolean {
  return TIER_RANK[entry.sensitivity] <= clearance;
}

export function disclose(scored: Scored[], clearance: Clearance): Disclosure {
  const visible: KnowledgeEntry[] = [];
  const hidden: KnowledgeEntry[] = [];
  for (const { entry } of scored) (canSee(entry, clearance) ? visible : hidden).push(entry);
  const hints = [...new Set(hidden.map((e) => e.releasable).filter((h): h is string => !!h))];
  return { visible, hidden, hints, withheldCount: hidden.length, topScore: scored[0]?.score ?? 0 };
}
