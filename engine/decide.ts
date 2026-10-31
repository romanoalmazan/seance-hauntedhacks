// The four outcomes (SPEC §7), as a pure function. Deterministic checks first; confidence is a rough extra signal.
import type { Policy, Status } from "../shared/types";
import type { Disclosure } from "./disclosure";
import type { Draft } from "./llm";

export type Decision =
  | { status: "answered" | "partial"; }
  | { status: "refused"; }
  | { status: "escalated"; reason: "no_knowledge" | "low_confidence" };

/** Before the model: can we decide without a draft? */
export function preDecide(d: Disclosure, policy: Policy): Decision | null {
  if (d.topScore < policy.minMatchScore) return { status: "escalated", reason: "no_knowledge" };
  if (d.visible.length === 0) return { status: "refused" };
  return null;
}

export function decide(d: Disclosure, draft: Draft | null, policy: Policy): Decision {
  const pre = preDecide(d, policy);
  if (pre) return pre;
  if (!draft || draft.needsOwner) return { status: "escalated", reason: "no_knowledge" };
  if (draft.confidence < policy.minConfidence) return { status: "escalated", reason: "low_confidence" };
  return { status: d.withheldCount > 0 ? "partial" : "answered" };
}

export type { Status };
