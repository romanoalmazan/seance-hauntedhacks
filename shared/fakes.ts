// In-memory stand-ins for UI work before the real wrappers land. Per process only: the hub
// lives in this module. Messages go through encode/parseMessage so the real schema is exercised.
import actuators from "../seed/actuators.json";
import battery from "../seed/battery.json";
import software from "../seed/software.json";
import controls from "../seed/controls.json";
import robotics from "../seed/robotics.json";
import { RAW_REQUEST_PREFIX } from "../asker/asker-agent";
import { encode, parseMessage, PROTOCOL_VERSION } from "./protocol";
import type { Answer, Ask, RelayClient } from "./protocol";
import type { TeamId } from "./types";

type Handler = Parameters<RelayClient["onMessage"]>[0];

const SEEDS: Record<TeamId, { profile: { ownerName: string }; knowledge: { id: string; title: string; full: string; sensitivity: string; releasable: string | null }[] }> = { battery, actuators, software, controls, robotics };
const EXPERTS = new Set(["expert-battery", "expert-actuators"]);
const LATENCY_MS = 20;
const OWNER_DELAY_MS = 3000;
const REGEN_REPLY =
  "Yes, up to 15 A regen. The BMS must be in a charge-enabled state, so check with Battery first.";

const clients = new Map<string, Handler[]>();

function answerTo(ask: Ask, fields: Partial<Answer>): Answer {
  return {
    v: PROTOCOL_VERSION,
    kind: "answer",
    requestId: ask.requestId,
    at: new Date().toISOString(),
    team: ask.to,
    status: "answered",
    text: "",
    confidence: 0.8,
    sources: [],
    withheld: { count: 0, hints: [], canRequestAccess: false },
    provenance: "expert_agent",
    ...fields,
  };
}

// Public only, so a fake answer to Guest never shows anything above their clearance.
function publicFields(team: TeamId): Pick<Answer, "text" | "sources"> {
  const entry = SEEDS[team].knowledge.find((e) => e.sensitivity === "public");
  if (!entry) return { text: "Not sure.", sources: [] };
  return { text: entry.full, sources: [{ id: entry.id, title: entry.title }] };
}

function batteryHint(id: string): string {
  const hint = SEEDS.battery.knowledge.find((e) => e.id === id)?.releasable;
  if (!hint) throw new Error(`seed/battery.json has no hint for ${id}`);
  return hint;
}

/** Keys on `sender`, the hub-stamped name, the way the actor keys clearance on identity. */
function firstAnswer(ask: Ask, sender: string): Answer {
  if (ask.to === "battery" && ask.requestId.startsWith(RAW_REQUEST_PREFIX)) {
    return answerTo(ask, {
      status: "refused",
      text: "I can't share that.",
      confidence: 0,
      withheld: {
        count: 2,
        hints: [batteryHint("bat-04"), batteryHint("bat-05")],
        canRequestAccess: true,
      },
    });
  }
  if (ask.to === "actuators" && /regen/i.test(ask.question)) {
    const ownerName = SEEDS.actuators.profile.ownerName;
    return answerTo(ask, {
      status: "escalated",
      text: `Not sure, I asked ${ownerName}.`,
      confidence: 0,
      ownerName,
      escalationId: `esc-${ask.requestId}`,
    });
  }
  if (ask.to === "battery" && sender === "asker-justin" && /current/i.test(ask.question)) {
    return answerTo(ask, {
      status: "partial",
      ...publicFields("battery"),
      withheld: { count: 1, hints: [batteryHint("bat-02")], canRequestAccess: false },
    });
  }
  return answerTo(ask, publicFields(ask.to));
}

function ownerAnswer(ask: Ask, escalated: Answer): Answer {
  return answerTo(ask, {
    text: REGEN_REPLY,
    confidence: 1,
    provenance: "owner",
    ownerName: escalated.ownerName,
    escalationId: escalated.escalationId,
  });
}

/** `sender` is stamped here by the hub, never read from the body, as Relay does. */
function deliver(sender: string, to: string, raw: string): void {
  setTimeout(() => {
    const msg = parseMessage(raw);
    if (!msg) {
      console.warn(`[fake relay] dropped invalid message from ${sender} to ${to}`);
      return;
    }
    if (EXPERTS.has(to)) {
      if (msg.kind !== "ask") return;
      const answer = firstAnswer(msg, sender);
      deliver(to, sender, encode(answer));
      if (answer.status === "escalated") {
        setTimeout(() => deliver(to, sender, encode(ownerAnswer(msg, answer))), OWNER_DELAY_MS);
      }
      return;
    }
    for (const handler of clients.get(to) ?? []) {
      Promise.resolve()
        .then(() => handler(msg, { sender }))
        .catch((err) => console.error(`[fake relay] handler for ${to} failed:`, err));
    }
  }, LATENCY_MS);
}

export async function fakeConnect(agent: string): Promise<RelayClient> {
  const handlers: Handler[] = [];
  clients.set(agent, handlers);
  return {
    agent,
    async send(to, msg) {
      if (!EXPERTS.has(to) && !clients.has(to)) throw new Error(`[fake relay] unknown agent ${to}`);
      deliver(agent, to, encode(msg));
    },
    onMessage(handler) {
      handlers.push(handler);
    },
    async close() {
      clients.delete(agent);
    },
  };
}
