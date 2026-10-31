// Model call (spike S3). Plain fetch so it can run inside a Terse actor.
// Without OPENAI_API_KEY + OPENAI_MODEL (or with LLM_FAKE=1) it falls back to a deterministic
// drafter that quotes the visible entries, so the skeleton and tests run offline.
import { z } from "zod";
import type { KnowledgeEntry } from "../shared/types.js";
import { SYSTEM_PROMPT, userPrompt } from "./prompts.js";

type Env = Record<string, string | undefined>;
// Read env without depending on Node typings (the Terse compiler type-checks this file too).
const processEnv = (): Env => (globalThis as { process?: { env: Env } }).process?.env ?? {};

export const DraftSchema = z.object({
  answer: z.string(),
  usedEntryIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  needsOwner: z.boolean(),
});
export type Draft = z.infer<typeof DraftSchema>;

export function fakeDraft(visible: KnowledgeEntry[]): Draft {
  if (visible.length === 0) return { answer: "I'm not sure.", usedEntryIds: [], confidence: 0, needsOwner: true };
  return {
    answer: visible.map((e) => `${e.full} [${e.id}]`).join(" "),
    usedEntryIds: visible.map((e) => e.id),
    confidence: 0.9,
    needsOwner: false,
  };
}

/** If the model left out inline [id] citations, append them so every answer shows its sources. */
export function withCitations(answer: string, used: string[]): string {
  if (!used.length || /\[[a-z]+-[a-z0-9]+\]/i.test(answer)) return answer;
  return `${answer.trim()} [${used.join(", ")}]`;
}

export function useFake(env: Env = processEnv()): boolean {
  return env.LLM_FAKE === "1" || !env.OPENAI_API_KEY || !env.OPENAI_MODEL;
}

export interface DraftOptions {
  timeoutMs?: number; // per attempt
  retries?: number; // extra attempts after the first
  fetcher?: typeof fetch; // injectable for tests
  warn?: (msg: string) => void;
}

/**
 * Real model draft. A model FAILURE (network error, timeout, non-2xx, invalid JSON or shape) is retried
 * once, then falls back to the deterministic drafter with a warning. It never escalates: only a model
 * that answered and said needsOwner (or low confidence) pages the owner. The fallback quotes visible
 * entries only, so the clearance rules are unchanged.
 */
export async function draft(
  question: string,
  context: string | undefined,
  visible: KnowledgeEntry[],
  env: Env = processEnv(),
  team?: string,
  opts: DraftOptions = {},
): Promise<Draft> {
  if (useFake(env)) return fakeDraft(visible);
  const { timeoutMs = 6000, retries = 1, fetcher = fetch, warn = (m: string) => console.warn(m) } = opts;
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callModel(question, context, visible, env, team, timeoutMs, fetcher);
    } catch (err) {
      lastError = (err as Error).message;
      warn(`[llm] attempt ${attempt + 1} failed: ${lastError}`);
    }
  }
  warn(`[llm] model unavailable (${lastError}); using the deterministic drafter`);
  return fakeDraft(visible);
}

async function callModel(
  question: string, context: string | undefined, visible: KnowledgeEntry[], env: Env, team: string | undefined,
  timeoutMs: number, fetcher: typeof fetch,
): Promise<Draft> {
  const res = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      response_format: { type: "json_object" },
      max_completion_tokens: 300,
      temperature: 0, // repeatable demo answers
      seed: 7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(question, context, visible, team) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  let json: unknown;
  try {
    json = JSON.parse(body.choices?.[0]?.message?.content ?? "");
  } catch {
    throw new Error("model returned invalid JSON");
  }
  const parsed = DraftSchema.safeParse(json);
  if (!parsed.success) throw new Error("model JSON has the wrong shape");
  // Only keep citations to entries the model was actually shown.
  const ids = new Set(visible.map((e) => e.id));
  const used = parsed.data.usedEntryIds.filter((id) => ids.has(id));
  return { ...parsed.data, answer: withCitations(parsed.data.answer, used), usedEntryIds: used };
}
