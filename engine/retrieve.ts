// Keyword-overlap retrieval (SPEC §4 step 2). Scores on title + tags only, so that
// incidental words in the full text (e.g. "pack" in bat-05) don't pull in unrelated entries.
import type { KnowledgeEntry } from "../shared/types";

export interface Scored { entry: KnowledgeEntry; score: number }

const STOP = new Set([
  "the", "and", "for", "with", "what", "how", "can", "does", "into", "from", "that", "this", "are", "is",
  "you", "your", "our", "its", "it's", "i'm", "who", "why", "when", "long", "much", "many", "any", "all",
  "have", "has", "was", "were", "will", "would", "should", "could", "about", "there", "their", "them", "they",
  "up", "to", "of", "in", "on", "at", "by", "or", "an", "a", "be", "do", "me", "my", "we", "us", "if", "so",
]);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/)) {
    const w = raw.replace(/^-+|-+$/g, "");
    if (!w || STOP.has(w)) continue;
    if (w.length < 3 && !/\d/.test(w)) continue;
    // "act-7" and "act7" are the same token
    out.add(stem(w.replace(/-/g, "")));
  }
  return out;
}

export function score(question: string, entry: KnowledgeEntry): number {
  const q = tokens(question);
  const e = tokens([entry.title, ...entry.tags].join(" "));
  let n = 0;
  for (const t of q) if (e.has(t)) n++;
  return n;
}

/**
 * Entries with overlap, best first, top 6. Entries scoring under half the best are dropped, so a
 * strong learned match (title = the question) isn't diluted by weak "ACT-7"-only hits.
 */
export function retrieve(question: string, knowledge: KnowledgeEntry[], k = 6): Scored[] {
  const scored = knowledge
    .map((entry) => ({ entry, score: score(question, entry) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  return scored.filter((s) => s.score * 2 >= top).slice(0, k);
}
