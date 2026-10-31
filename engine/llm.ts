// Model call (spike S3). Plain fetch so it can run inside a Terse actor.
// Without OPENAI_API_KEY + OPENAI_MODEL (or with LLM_FAKE=1) it falls back to a deterministic
// drafter that quotes the visible entries, so the skeleton and tests run offline.
import { z } from "zod";
import type { KnowledgeEntry } from "../shared/types";
import { SYSTEM_PROMPT, userPrompt } from "./prompts";

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

export function useFake(env: Record<string, string | undefined> = process.env): boolean {
  return env.LLM_FAKE === "1" || !env.OPENAI_API_KEY || !env.OPENAI_MODEL;
}

export async function draft(
  question: string,
  context: string | undefined,
  visible: KnowledgeEntry[],
  env: Record<string, string | undefined> = process.env,
): Promise<Draft> {
  if (useFake(env)) return fakeDraft(visible);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      response_format: { type: "json_object" },
      max_completion_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(question, context, visible) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices: { message: { content: string | null } }[] };
  const parsed = DraftSchema.safeParse(JSON.parse(body.choices[0]?.message.content ?? "{}"));
  if (!parsed.success) return { answer: "I'm not sure.", usedEntryIds: [], confidence: 0, needsOwner: true };
  // Only keep citations to entries the model was actually shown.
  const ids = new Set(visible.map((e) => e.id));
  return { ...parsed.data, usedEntryIds: parsed.data.usedEntryIds.filter((id) => ids.has(id)) };
}
