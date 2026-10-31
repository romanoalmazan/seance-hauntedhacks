// In-memory stand-ins for UI work before the real wrappers land. Per process only: the hub
// lives in this module. Messages go through encode/parseMessage so the real schema is exercised.
import actuators from "../seed/actuators.json";
import battery from "../seed/battery.json";
import { encode, parseMessage, PROTOCOL_VERSION } from "./protocol";
import type { Answer, Ask, RelayClient } from "./protocol";

type Handler = Parameters<RelayClient["onMessage"]>[0];

const SEEDS = { battery, actuators };
const EXPERTS = new Set(["expert-battery", "expert-actuators"]);
const LATENCY_MS = 20;

const clients = new Map<string, Handler[]>();

function cannedAnswer(ask: Ask): Answer {
  // Public only, so a fake answer to Guest never shows anything above their clearance.
  const entry = SEEDS[ask.to].knowledge.find((e) => e.sensitivity === "public");
  if (!entry) throw new Error(`seed/${ask.to}.json has no public entry`);
  return {
    v: PROTOCOL_VERSION,
    kind: "answer",
    requestId: ask.requestId,
    at: new Date().toISOString(),
    team: ask.to,
    status: "answered",
    text: entry.full,
    confidence: 0.8,
    sources: [{ id: entry.id, title: entry.title }],
    withheld: { count: 0, hints: [], canRequestAccess: false },
    provenance: "expert_agent",
  };
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
      if (msg.kind === "ask") deliver(to, sender, encode(cannedAnswer(msg)));
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
