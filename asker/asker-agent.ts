// The asker: carries the question to the teams the user named and merges what comes back.
// It depends only on a `connect` function, so the fake and the real Relay are interchangeable.
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { Answer, Ask, RelayClient } from "../shared/protocol";
import type { TeamId } from "../shared/types";
import { describeDirectory, DIRECTORY, findTeam, teamInfo } from "./directory";
import { sanitizeContext, stripPii } from "./sanitize";

export type Connect = (agent: string) => Promise<RelayClient>;

export interface AskerIdentity {
  agent: string; // Relay agent name. Experts identify the asker by the Relay sender, not this field.
  human: string;
  team: string;
}

/**
 * One team's side of a question. A later answer with the same requestId replaces `answer`,
 * except that an owner's answer is final: nothing but another owner answer replaces it.
 */
export interface AskRecord {
  requestId: string;
  team: TeamId;
  question: string;
  answer: Answer | null;
  error: string | null;
}

export interface MergedReply {
  text: string; // plain concatenation, one block per team, in the order the user named them
  asks: AskRecord[];
  notice: string | null; // anything the agent has to tell the user itself
}

export interface Asker {
  identity: AskerIdentity;
  store: Map<string, AskRecord>;
  ask(text: string, context?: string): Promise<MergedReply>;
  /** Called for every stored answer, late ones included. Returns the unsubscribe function. */
  onUpdate(listener: (record: AskRecord) => void): () => void;
  /** Forgets every ask, so a late answer from the last run is dropped. */
  reset(): void;
  /** Called after each reset. Returns the unsubscribe function. */
  onReset(listener: () => void): () => void;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Marks a raw ask's requestId, for logs and so the fake expert can recognise one. To a real
 * expert it's an opaque id: nothing changes the text or the contract, so an attack lands as typed.
 */
export const RAW_REQUEST_PREFIX = "raw-";

// `/raw <team> <text>`. Everything after the team is kept exactly as typed.
const RAW = /^\s*\/raw(?:\s+@?(\S+)(?:\s+(\S[\s\S]*))?)?\s*$/i;
const RAW_USAGE = `Usage: /raw <team> <text>. Teams: ${DIRECTORY.map((t) => t.teamId).join(", ")}.`;

// The lookbehind keeps the "@battery" in dana@battery.com from reading as a mention.
const MENTION = /(?<![\w.+-])@([a-z][\w-]*)/gi;

export interface ParsedMentions {
  teams: TeamId[]; // deduped, in the order named
  unknown: string[]; // @names that are not in the directory
  question: string; // the text with the team mentions removed
}

export function parseMentions(text: string): ParsedMentions {
  const teams: TeamId[] = [];
  const unknown: string[] = [];
  for (const [, name = ""] of text.matchAll(MENTION)) {
    const team = findTeam(name)?.teamId;
    if (!team) {
      if (!unknown.includes(name)) unknown.push(name);
    } else if (!teams.includes(team)) {
      teams.push(team);
    }
  }
  const question = text
    .replace(MENTION, (mention, name: string) => (findTeam(name) ? "" : mention))
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:!?]+/, "")
    .trim();
  return { teams, unknown, question };
}

function describeRecord({ team, answer, error }: AskRecord): string {
  const { displayName: name, ownerName } = teamInfo(team);
  if (!answer) return `${name}: ${error ?? "no answer yet"}`;
  const label =
    answer.provenance === "owner" ? `${answer.ownerName ?? ownerName}'s answer` : answer.status;
  const lines = [`${name} (${label}): ${answer.text}`];
  if (answer.sources.length > 0) {
    lines.push(`Sources: ${answer.sources.map((s) => `${s.id} ${s.title}`).join("; ")}`);
  }
  if (answer.withheld.count > 0) {
    lines.push(`Withheld: ${[answer.withheld.count, ...answer.withheld.hints].join(". ")}`);
  }
  return lines.join("\n");
}

export function mergeAnswers(asks: AskRecord[]): string {
  return asks.map(describeRecord).join("\n\n");
}

function noticeOnly(notice: string): MergedReply {
  return { text: notice, asks: [], notice };
}

export async function createAsker(
  identity: AskerIdentity,
  connect: Connect,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<Asker> {
  const client = await connect(identity.agent);
  const store = new Map<string, AskRecord>();
  const waiters = new Map<string, () => void>();
  const listeners = new Set<(record: AskRecord) => void>();
  const resetListeners = new Set<() => void>();

  client.onMessage((msg, { sender }) => {
    if (msg.kind !== "answer") return;
    const record = store.get(msg.requestId);
    // Only the expert this ask went to may answer it. Identity is the Relay sender.
    if (!record || sender !== teamInfo(record.team).address) return;
    // Deliveries replay, so an old `escalated` can land after the owner's answer.
    if (record.answer?.provenance === "owner" && msg.provenance !== "owner") return;
    record.answer = msg;
    waiters.get(msg.requestId)?.();
    for (const listener of listeners) listener(record);
  });

  /** Resolves on the first answer or at the timeout. Registered before sending, so no answer can beat it. */
  function untilAnswered(requestId: string): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        waiters.delete(requestId);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      waiters.set(requestId, done);
    });
  }

  async function askTeam(
    team: TeamId,
    question: string,
    context: string,
    { raw = false }: { raw?: boolean } = {},
  ): Promise<AskRecord> {
    const requestId = `${raw ? RAW_REQUEST_PREFIX : ""}${crypto.randomUUID()}`;
    const record: AskRecord = { requestId, team, question, answer: null, error: null };
    store.set(requestId, record);
    const answered = untilAnswered(requestId);

    const ask: Ask = {
      v: PROTOCOL_VERSION,
      kind: "ask",
      requestId,
      at: new Date().toISOString(),
      from: { agent: identity.agent, human: identity.human, team: identity.team },
      to: team,
      question,
      ...(context ? { context } : {}),
    };
    try {
      await client.send(teamInfo(team).address, ask);
    } catch (err) {
      // One unreachable team must not cost the user the other team's answer.
      console.error(`[${identity.agent}] could not send to ${team}:`, err);
      record.error = `could not reach ${teamInfo(team).displayName}`;
      waiters.get(requestId)?.();
    }
    await answered;
    return record;
  }

  return {
    identity,
    store,
    async ask(text, context = "") {
      const raw = text.match(RAW);
      if (raw) {
        const [, teamName = "", rawText = ""] = raw;
        const team = findTeam(teamName)?.teamId;
        if (!team || !rawText) return noticeOnly(RAW_USAGE);
        const record = await askTeam(team, rawText, "", { raw: true });
        return { text: mergeAnswers([record]), asks: [record], notice: null };
      }

      const { teams, unknown, question } = parseMentions(text);
      const unknownNote =
        unknown.length > 0
          ? `I don't know ${unknown.map((name) => `@${name}`).join(", ")}, so nothing went there.`
          : null;

      if (teams.length === 0) {
        const lead = unknownNote ?? "Which team should I ask? Name one with @.";
        return noticeOnly(`${lead}\n${describeDirectory()}`);
      }
      if (!question) {
        return noticeOnly(`What should I ask ${teams.map((t) => `@${t}`).join(" and ")}?`);
      }

      const cleanQuestion = stripPii(question);
      const cleanContext = sanitizeContext(context);
      const asks = await Promise.all(
        teams.map((team) => askTeam(team, cleanQuestion, cleanContext)),
      );
      const merged = mergeAnswers(asks);
      return {
        text: unknownNote ? `${unknownNote}\n\n${merged}` : merged,
        asks,
        notice: unknownNote,
      };
    },
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      store.clear();
      for (const listener of resetListeners) listener();
    },
    onReset(listener) {
      resetListeners.add(listener);
      return () => resetListeners.delete(listener);
    },
    close: () => client.close(),
  };
}
