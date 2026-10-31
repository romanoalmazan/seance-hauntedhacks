// Relay message contract (SPEC §10). Every message is one JSON string in the DM body.
// Identity is NOT in these messages: it is the Relay-stamped sender name (ctx.sender).
import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const teamId = z.enum(["battery", "actuators", "software"]);
const tier = z.enum(["public", "internal", "restricted"]);
const status = z.enum(["answered", "partial", "refused", "escalated"]);

const base = {
  v: z.literal(PROTOCOL_VERSION),
  requestId: z.string().min(1),
  at: z.string().min(1), // ISO timestamp
};

export const escalationSchema = z.object({
  id: z.string().min(1),
  requestId: z.string().min(1),
  asker: z.string(),
  question: z.string(),
  reason: z.enum(["no_knowledge", "low_confidence", "access_request"]),
  status: z.enum(["pending", "answered", "approved", "denied"]),
});

/** asker -> expert */
export const askSchema = z.object({
  ...base,
  kind: z.literal("ask"),
  from: z.object({ agent: z.string(), human: z.string(), team: z.string() }),
  to: teamId,
  question: z.string().min(1),
  context: z.string().max(300).optional(),
});

/** expert -> asker. An escalation sends two: first `escalated`, later the owner's (same requestId). */
export const answerSchema = z.object({
  ...base,
  kind: z.literal("answer"),
  team: teamId, // which expert is speaking, so askers can show who said what
  status,
  text: z.string(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.object({ id: z.string(), title: z.string() })),
  withheld: z.object({
    count: z.number().int().min(0),
    hints: z.array(z.string()),
    canRequestAccess: z.boolean(),
  }),
  provenance: z.enum(["expert_agent", "owner"]),
  ownerName: z.string().optional(),
  escalationId: z.string().optional(),
});

/** expert -> console */
export const escalationNoticeSchema = z.object({
  ...base,
  kind: z.literal("escalation_notice"),
  teamId,
  escalation: escalationSchema,
});

/** console -> expert */
export const ownerReplySchema = z.object({
  ...base,
  kind: z.literal("owner_reply"),
  escalationId: z.string().min(1),
  ownerName: z.string(),
  text: z.string().min(1),
  save: z.boolean(),
  sensitivity: tier,
  tags: z.array(z.string()),
});

/** console -> expert. Stretch. */
export const accessDecisionSchema = z.object({
  ...base,
  kind: z.literal("access_decision"),
  escalationId: z.string().min(1),
  approve: z.boolean(),
});

export const messageSchema = z.discriminatedUnion("kind", [
  askSchema,
  answerSchema,
  escalationNoticeSchema,
  ownerReplySchema,
  accessDecisionSchema,
]);

export type Ask = z.infer<typeof askSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type EscalationNotice = z.infer<typeof escalationNoticeSchema>;
export type OwnerReply = z.infer<typeof ownerReplySchema>;
export type AccessDecision = z.infer<typeof accessDecisionSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageKind = Message["kind"];

export function encode(msg: Message): string {
  return JSON.stringify(msg);
}

/** Returns null on any failure: bad JSON, wrong shape, unknown kind, wrong version. */
export function parseMessage(raw: string): Message | null {
  try {
    const result = messageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// Implemented by the core lane in shared/relay.ts, which exports: connect(agent: string): Promise<RelayClient>
export interface RelayClient {
  agent: string;
  send(to: string, msg: Message): Promise<void>;
  /** sender = the Relay-stamped agent name, never taken from the body */
  onMessage(handler: (msg: Message, ctx: { sender: string }) => void | Promise<void>): void;
  close(): Promise<void>;
}
