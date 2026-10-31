// The four outcomes (SPEC §7), as a pure function. Deterministic checks first; confidence is a rough extra signal.
import type { Policy, Status } from "../shared/types.js";
import type { Disclosure } from "./disclosure.js";
import type { Draft } from "./llm.js";

export type Decision =
  | { status: "answered" | "partial"; }
  | { status: "refused"; }
  | { status: "escalated"; reason: "no_knowledge" | "low_confidence" };

// Prompt-injection / exfiltration phrasing. Refused outright instead of escalated, so a red-team
// run doesn't page the owner. Not the security barrier (the model never sees hidden entries).
const INJECTION = [
  /\b(ignore|disregard|forget|bypass)\b.{0,40}\b(rules?|instructions?|policy|polic(y|ies)|guard)/i,
  /\b(ignorez|ignora|ignoriere)\b/i,
  /\bsystem prompt\b/i,
  /\bverbatim\b/i,
  /\boverride\b/i,
  /\b(every|all)\b.{0,25}\b(entr(y|ies)|restricted|internal)\b/i,
  /\b(base64|rot13|hex[- ]?encode)\b/i,
  /\bclearance\b.{0,30}\b(raised|is|was|=)\b/i,
];

export function looksLikeInjection(question: string): boolean {
  return INJECTION.some((re) => re.test(question));
}

/** Before the model: can we decide without a draft? */
export function preDecide(d: Disclosure, policy: Policy, question = ""): Decision | null {
  if (looksLikeInjection(question)) return { status: "refused" };
  if (d.topScore < policy.minMatchScore) return { status: "escalated", reason: "no_knowledge" };
  if (d.visible.length === 0) return { status: "refused" };
  return null;
}

export function decide(d: Disclosure, draft: Draft | null, policy: Policy, question = ""): Decision {
  const pre = preDecide(d, policy, question);
  if (pre) return pre;
  if (!draft || draft.needsOwner) return { status: "escalated", reason: "no_knowledge" };
  if (draft.confidence < policy.minConfidence) return { status: "escalated", reason: "low_confidence" };
  return { status: d.withheldCount > 0 ? "partial" : "answered" };
}

export type { Status };
