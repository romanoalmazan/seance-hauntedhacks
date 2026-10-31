// Expert logic as plain functions over a state object (kickoff C4). Each mutator returns a NEW state;
// the Terse actor shell reassigns its @Persisted fields from it, which also sidesteps the
// "push isn't persisted" bug. No Terse or Relay imports here.
import type {
  AuditEvent, Clearance, Escalation, EventKind, FeedEvent, KnowledgeEntry, Policy, Snapshot, Stats, Tier,
} from "./vendor/shared/types.js";
import type { Answer, Ask, OwnerReply } from "./vendor/shared/protocol.js";
import { clearanceOf, decide, disclose, guard, preDecide, retrieve, type Draft } from "./vendor/engine/index.js";

export const AUDIT_CAP = 200;

/** seed/<team>.json. The seed carries no policy, so the demo policy (SPEC §9) is supplied here. */
export interface SeedFile { profile: Snapshot["profile"]; knowledge: KnowledgeEntry[]; policy?: Policy }

export const DEMO_POLICY: Policy = {
  // expert-actuators stays public-only: whatever it learns from Battery can be relayed to any asker.
  clearance: { "asker-priya": 1, "asker-guest": 0, "expert-actuators": 0 },
  defaultClearance: 0, minMatchScore: 2, minConfidence: 0.6, allowAccessRequests: true,
};
const HANDLED_CAP = 500;

export interface ExpertState extends Snapshot {
  /** requestId -> result, so a replayed delivery is handled once. */
  handled: { requestId: string; result: AskResult }[];
}

/** An answer body; the bridge adds v, kind, requestId and at. */
export type AnswerBody = Omit<Answer, "v" | "kind" | "requestId" | "at">;

export interface AskResult {
  duplicate: boolean;
  answer: AnswerBody;
  escalation?: Escalation; // set when status is escalated: send an escalation_notice to console
  feed: FeedEvent;
}

export interface OwnerReplyResult {
  duplicate: boolean;
  to?: string; // the original asker's Relay agent
  requestId?: string;
  answer?: AnswerBody;
  feed?: FeedEvent;
}

/** What the model may see. Hidden entries are never in here. */
export interface Prepared {
  question: string;
  context?: string;
  visible: KnowledgeEntry[];
  /** false: no model call needed, the outcome is already decided. */
  needsDraft: boolean;
}

const now = () => new Date().toISOString();
const zeroStats = (): Stats => ({ asked: 0, answeredAuto: 0, repeatsServed: 0, escalated: 0, learned: 0, blocked: 0 });

export function fromSeed(seed: SeedFile): ExpertState {
  return {
    profile: { ...seed.profile },
    knowledge: seed.knowledge.map((e) => ({ ...e, tags: [...e.tags], protectedTokens: [...e.protectedTokens] })),
    policy: structuredClone(seed.policy ?? DEMO_POLICY),
    pending: [],
    audit: [],
    stats: zeroStats(),
    handled: [],
  };
}

export function snapshot(s: ExpertState): Snapshot {
  const { profile, knowledge, policy, pending, audit, stats } = s;
  return structuredClone({ profile, knowledge, policy, pending, audit, stats });
}

export function setSensitivity(s: ExpertState, entryId: string, tier: Tier): ExpertState {
  return { ...s, knowledge: s.knowledge.map((e) => (e.id === entryId ? { ...e, sensitivity: tier } : e)) };
}

export function setClearance(s: ExpertState, agent: string, level: Clearance): ExpertState {
  return { ...s, policy: { ...s.policy, clearance: { ...s.policy.clearance, [agent]: level } } };
}

function withAudit(s: ExpertState, ev: AuditEvent): ExpertState {
  return { ...s, audit: [...s.audit, ev].slice(-AUDIT_CAP) };
}

function feedEvent(s: ExpertState, asker: string, question: string, decision: EventKind): FeedEvent {
  return { time: now(), team: s.profile.teamId, asker, question, decision };
}

function cached(s: ExpertState, requestId: string): AskResult | undefined {
  return s.handled.find((h) => h.requestId === requestId)?.result;
}

/** Step 2: clearance from the Relay-stamped sender (never the body), retrieve, split. */
export function prepare(s: ExpertState, sender: string, ask: Ask): Prepared {
  const clearance = clearanceOf(sender, s.policy);
  const d = disclose(retrieve(ask.question, s.knowledge), clearance);
  return { question: ask.question, context: ask.context, visible: d.visible, needsDraft: preDecide(d, s.policy, ask.question) === null };
}

/** Steps 4–5: guard, decide, log. Returns the new state and what to send. */
export function finalize(s: ExpertState, sender: string, ask: Ask, draft: Draft | null): { state: ExpertState; result: AskResult } {
  const prior = cached(s, ask.requestId);
  if (prior) return { state: s, result: { ...prior, duplicate: true } };

  const clearance = clearanceOf(sender, s.policy);
  const d = disclose(retrieve(ask.question, s.knowledge), clearance);
  const decision = decide(d, draft, s.policy, ask.question);
  const owner = s.profile.ownerName;
  const withheld = { count: d.withheldCount, hints: d.hints, canRequestAccess: s.policy.allowAccessRequests && d.withheldCount > 0 };
  const stats = { ...s.stats, asked: s.stats.asked + 1 };
  let pending = s.pending;
  let escalation: Escalation | undefined;
  let kind: EventKind = decision.status;
  let leakPrevented = false;
  let entriesUsed: string[] = [];
  let answer: AnswerBody;
  const base = { team: s.profile.teamId, provenance: "expert_agent" as const, ownerName: owner, withheld };

  if (decision.status === "escalated") {
    escalation = {
      id: `esc-${ask.requestId}`, requestId: ask.requestId, asker: sender, question: ask.question,
      reason: decision.reason, status: "pending",
    };
    pending = [...pending, escalation];
    stats.escalated++;
    answer = {
      ...base, status: "escalated", confidence: draft?.confidence ?? 0, sources: [], escalationId: escalation.id,
      text: `Not sure. I asked ${owner}. I'll update this when they answer.`,
    };
  } else if (decision.status === "refused") {
    answer = { ...base, status: "refused", confidence: 1, sources: [], text: "I can't share that at your access level." };
  } else {
    const shown = new Map(d.visible.map((e) => [e.id, e]));
    const used = (draft!.usedEntryIds.length ? draft!.usedEntryIds : d.visible.map((e) => e.id)).filter((id) => shown.has(id));
    const g = guard(draft!.answer, s.knowledge, clearance);
    if (!g.ok) {
      kind = "guard_blocked";
      leakPrevented = true;
      stats.blocked++;
      answer = { ...base, status: "refused", confidence: 1, sources: [], text: "I can't share that at your access level." };
    } else {
      entriesUsed = used;
      stats.answeredAuto++;
      if (used.some((id) => shown.get(id)?.source === "owner_answer")) stats.repeatsServed++;
      answer = {
        ...base, status: decision.status, confidence: draft!.confidence, text: draft!.answer,
        sources: used.map((id) => ({ id, title: shown.get(id)!.title })),
      };
    }
  }

  const feed = feedEvent(s, sender, ask.question, kind);
  const result: AskResult = { duplicate: false, answer, escalation, feed };
  let next: ExpertState = {
    ...s, pending, stats,
    handled: [...s.handled, { requestId: ask.requestId, result }].slice(-HANDLED_CAP),
  };
  next = withAudit(next, {
    time: feed.time, asker: sender, question: ask.question, decision: kind,
    entriesUsed, entriesWithheld: d.hidden.map((e) => e.id), leakPrevented,
  });
  return { state: next, result };
}

/** prepare -> draft -> finalize in one call, so text never leaves the actor. */
export async function ask(
  s: ExpertState, sender: string, a: Ask, drafter: (p: Prepared) => Promise<Draft>,
): Promise<{ state: ExpertState; result: AskResult }> {
  const prior = cached(s, a.requestId);
  if (prior) return { state: s, result: { ...prior, duplicate: true } };
  const p = prepare(s, sender, a);
  const draft = p.needsDraft ? await drafter(p) : null;
  return finalize(s, sender, a, draft);
}

/** Owner answered an escalation (SPEC §8). Saves an entry only when reply.save is ticked. */
export function ownerReply(s: ExpertState, reply: OwnerReply): { state: ExpertState; result: OwnerReplyResult } {
  const esc = s.pending.find((e) => e.id === reply.escalationId);
  if (!esc || esc.status !== "pending") return { state: s, result: { duplicate: true } };

  const pending = s.pending.map((e) => (e.id === esc.id ? { ...e, status: "answered" as const } : e));
  let next: ExpertState = { ...s, pending };
  let sources: AnswerBody["sources"] = [];
  let feed: FeedEvent | undefined;

  if (reply.save) {
    const n = s.knowledge.filter((e) => e.source === "owner_answer").length + 1;
    const prefix = s.knowledge[0]?.id.split("-")[0] ?? s.profile.teamId;
    const entry: KnowledgeEntry = {
      id: `${prefix}-L${n}`, title: esc.question, tags: reply.tags.map((t) => t.toLowerCase()),
      sensitivity: reply.sensitivity, full: reply.text,
      releasable: reply.sensitivity === "public" ? null : `${reply.ownerName} answered a related question; details are ${reply.sensitivity}.`,
      protectedTokens: [], source: "owner_answer",
    };
    next = { ...next, knowledge: [...next.knowledge, entry], stats: { ...next.stats, learned: next.stats.learned + 1 } };
    sources = [{ id: entry.id, title: entry.title }];
    feed = feedEvent(s, esc.asker, esc.question, "learned");
    next = withAudit(next, {
      time: feed.time, asker: esc.asker, question: esc.question, decision: "learned",
      entriesUsed: [entry.id], entriesWithheld: [], leakPrevented: false,
    });
  } else {
    // Not saved: still one audit + feed event, so the owner's answer shows in the log.
    feed = feedEvent(s, esc.asker, esc.question, "answered");
    next = withAudit(next, {
      time: feed.time, asker: esc.asker, question: esc.question, decision: "answered",
      entriesUsed: [], entriesWithheld: [], leakPrevented: false,
    });
  }

  // Backstop: the owner's text is guarded against the original asker's clearance too.
  const g = guard(reply.text, next.knowledge, clearanceOf(esc.asker, next.policy));
  const answer: AnswerBody = {
    team: s.profile.teamId, provenance: "owner", ownerName: reply.ownerName, escalationId: esc.id,
    withheld: { count: 0, hints: [], canRequestAccess: false },
    ...(g.ok
      ? { status: "answered" as const, text: reply.text, confidence: 1, sources }
      : { status: "refused" as const, text: "I can't share that at your access level.", confidence: 1, sources: [] }),
  };
  if (!g.ok) next = { ...next, stats: { ...next.stats, blocked: next.stats.blocked + 1 } };
  return { state: next, result: { duplicate: false, to: esc.asker, requestId: esc.requestId, answer, feed } };
}
