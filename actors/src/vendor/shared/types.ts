// Contract types shared by both lanes. Owned by surfaces; see SPEC §6, §9, §10.
export type TeamId = "battery" | "actuators";
export type Tier = "public" | "internal" | "restricted"; // ranks 0, 1, 2
export type Clearance = 0 | 1 | 2;
export type Status = "answered" | "partial" | "refused" | "escalated";
export type EventKind = Status | "guard_blocked" | "learned";

export interface KnowledgeEntry {
  id: string;
  title: string;
  tags: string[];
  sensitivity: Tier;
  full: string;
  releasable: string | null;
  protectedTokens: string[];
  source: "seed" | "owner_answer";
}

export interface Policy {
  clearance: Record<string, Clearance>; // keyed by Relay agent name
  defaultClearance: Clearance;
  minMatchScore: number;
  minConfidence: number;
  allowAccessRequests: boolean;
}

export interface Escalation {
  id: string;
  requestId: string;
  asker: string;
  question: string;
  reason: "no_knowledge" | "low_confidence" | "access_request";
  status: "pending" | "answered" | "approved" | "denied";
}

export interface AuditEvent {
  time: string;
  asker: string;
  question: string;
  decision: EventKind;
  entriesUsed: string[];
  entriesWithheld: string[];
  leakPrevented: boolean;
}

export interface Stats {
  asked: number;
  answeredAuto: number;
  repeatsServed: number;
  escalated: number;
  learned: number;
  blocked: number;
}

export interface Snapshot {
  profile: { teamId: TeamId; displayName: string; ownerName: string };
  knowledge: KnowledgeEntry[];
  policy: Policy;
  pending: Escalation[];
  audit: AuditEvent[];
  stats: Stats;
}

export interface FeedEvent {
  time: string;
  team: TeamId;
  asker: string;
  question: string;
  decision: EventKind;
}

// The only actor calls the surfaces lane makes. Implemented by the core lane in
// shared/actors.ts, which exports: expert(team: TeamId): ConsoleActorApi and feed(): FeedApi
export interface ConsoleActorApi {
  snapshot(): Promise<Snapshot>;
  setSensitivity(entryId: string, tier: Tier): Promise<void>;
  setClearance(agent: string, level: Clearance): Promise<void>;
  reset(): Promise<void>;
}

// reset: assumption (SPEC §9), Reset must clear the timeline
export interface FeedApi {
  recent(n?: number): Promise<FeedEvent[]>;
  reset(): Promise<void>;
}
