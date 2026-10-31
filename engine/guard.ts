// Output guard (SPEC §7): scan the finished answer for protected tokens of every entry
// the asker cannot see. Normalized = lowercase, spaces and punctuation stripped.
import type { Clearance, KnowledgeEntry } from "../shared/types.js";
import { canSee } from "./disclosure.js";

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export interface GuardResult { ok: boolean; hits: string[] }

/**
 * Digits-only tokens ("$4.15" -> "415", "6.2%" -> "62") must not sit inside a longer number,
 * otherwise "16.25 A" would refuse a good answer (SPEC §7 false-positive note).
 */
export function containsToken(normAnswer: string, token: string): boolean {
  const t = normalize(token);
  if (!t) return false;
  if (!/^\d+$/.test(t)) return normAnswer.includes(t);
  const re = new RegExp(`(^|\\D)${t}(\\D|$)`);
  return re.test(normAnswer);
}

export function guard(answer: string, knowledge: KnowledgeEntry[], clearance: Clearance): GuardResult {
  const n = normalize(answer);
  const hits: string[] = [];
  for (const e of knowledge) {
    if (canSee(e, clearance)) continue;
    for (const tok of e.protectedTokens) if (containsToken(n, tok)) hits.push(tok);
  }
  return { ok: hits.length === 0, hits };
}
