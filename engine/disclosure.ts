// Split retrieved entries by the asker's clearance (SPEC §6). Hidden entries contribute only their hint.
import { TIER_RANK, type Clearance, type KnowledgeEntry, type Policy } from "../shared/types";
import type { Scored } from "./retrieve";

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
