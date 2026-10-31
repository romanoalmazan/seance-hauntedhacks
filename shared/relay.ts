// Real RelayClient over a local Relaycast engine (@relaycast/sdk 12.x).
// connect(agent) loads that agent's token from .relay-tokens.json (written by scripts/setup-relay.ts)
// and honors RELAY_BASE_URL (default http://localhost:8787).
//
// Delivery semantics:
//  - Realtime via the SDK WebSocket (subscribe ['@self']); no polling.
//  - On start and on every reconnect/resync we drain agent.deliveries() (queued + delivered) and ack each.
//    The SDK also replays queued deliveries over the socket on reconnect (and auto-acks those frames).
//  - Dedupe, per receiving client (in memory), on TWO keys; either hit drops the message:
//      1. Relay message id (identical across socket replay and the deliveries drain).
//      2. sender + kind + requestId + discriminator, where the discriminator is
//         answer: provenance/status (so the "escalated" answer and the later owner answer for the same
//         requestId both get through), owner_reply/access_decision: escalationId, escalation_notice: escalation.id,
//         ask: the target team. This catches a sender re-sending the same logical message with a new Relay id.
//  - Bodies are zod-validated with parseMessage; invalid ones are dropped (and acked so they don't replay forever).
//  - ctx.sender is message.agentName as stamped by Relay, never anything from the body.
import { RelayCast } from "@relaycast/sdk";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encode, parseMessage, type Message, type RelayClient } from "./protocol";

const TOKENS_PATH = resolve(import.meta.dir, "..", ".relay-tokens.json");

type Handler = (msg: Message, ctx: { sender: string }) => void | Promise<void>;
type TokenFile = { baseUrl: string; workspaceKey: string; agents: Record<string, string> };

export function loadTokens(): TokenFile {
  if (!existsSync(TOKENS_PATH)) throw new Error("No .relay-tokens.json. Run: bun scripts/setup-relay.ts");
  return JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
}

/** Logical dedupe key (see header). Exported for tests. */
export function logicalKey(sender: string, m: Message): string {
  let d = "";
  switch (m.kind) {
    case "answer": d = `${m.provenance}/${m.status}`; break;
    case "owner_reply": case "access_decision": d = m.escalationId; break;
    case "escalation_notice": d = m.escalation.id; break;
    case "ask": d = m.to; break;
  }
  return `${sender}|${m.kind}|${m.requestId}|${d}`;
}

export interface ConnectOptions { baseUrl?: string; token?: string; log?: (s: string) => void }

export async function connect(agent: string, opts: ConnectOptions = {}): Promise<RelayClient> {
  const tokens = opts.token ? null : loadTokens();
  const token = opts.token ?? tokens!.agents[agent];
  if (!token) throw new Error(`No Relay token for agent "${agent}" in .relay-tokens.json`);
  const baseUrl = opts.baseUrl ?? process.env.RELAY_BASE_URL ?? tokens?.baseUrl ?? "http://localhost:8787";
  const log = opts.log ?? (() => {});

  // relay.as(token) only needs a client; workspace key is not required for agent operations.
  const relay = new RelayCast({ apiKey: tokens?.workspaceKey ?? "unused", baseUrl });
  const me = relay.as(token);

  const handlers: Handler[] = [];
  const seenIds = new Set<string>();
  const seenLogical = new Set<string>();
  const backlog: { msg: Message; sender: string }[] = []; // messages that arrived before any handler was set
  let closed = false;

  async function dispatch(msg: Message, sender: string) {
    if (!handlers.length) { backlog.push({ msg, sender }); return; }
    for (const h of handlers) {
      try { await h(msg, { sender }); } catch (e) { console.error(`[relay:${agent}] handler error`, e); }
    }
  }

  /** Returns true if the message was new and dispatched. */
  async function ingest(relayId: string | undefined, sender: string | undefined, text: string | undefined) {
    if (!sender || sender === agent || typeof text !== "string") return false;
    if (relayId) { if (seenIds.has(relayId)) { log(`dup relay id ${relayId}`); return false; } seenIds.add(relayId); }
    const msg = parseMessage(text);
    if (!msg) { log(`dropped invalid message from ${sender}`); return false; }
    const key = logicalKey(sender, msg);
    if (seenLogical.has(key)) { log(`dup logical ${key}`); return false; }
    seenLogical.add(key);
    await dispatch(msg, sender);
    return true;
  }

  let draining: Promise<void> | null = null;
  async function drain() {
    if (draining) return draining;
    draining = (async () => {
      try {
        const items = await me.deliveries({ limit: 200 });
        for (const item of items as any[]) {
          const m = item.message ?? {};
          await ingest(m.id ?? item.messageId, m.agentName, m.text);
          try { await me.ackDelivery(item.id); } catch (e) { log(`ack failed ${item.id}: ${e}`); }
        }
        if (items.length) log(`drained ${items.length} deliveries`);
      } catch (e) { log(`drain failed: ${e}`); }
    })().finally(() => { draining = null; });
    return draining;
  }

  me.subscribe(["@self"], (ev: any) => {
    if (ev?.type !== "dm.received") return;
    void ingest(ev.message?.id, ev.message?.agentName, ev.message?.text);
  });
  me.on.connected(() => { log("connected"); void drain(); });
  me.on.resynced(() => { void drain(); });
  me.on.reconnecting((n) => log(`reconnecting (${n})`));
  me.connect();
  await drain(); // drain on start, even before the socket is up

  return {
    agent,
    async send(to: string, msg: Message) {
      await me.dm(to, encode(msg));
    },
    onMessage(handler: Handler) {
      handlers.push(handler);
      if (handlers.length === 1 && backlog.length) {
        const pending = backlog.splice(0);
        void (async () => { for (const p of pending) await dispatch(p.msg, p.sender); })();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try { await me.disconnect(); } catch {}
    },
  };
}
