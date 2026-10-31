// One process per team: bun bridge/expert-bridge.ts battery
// Listens on Relay as expert-<team>. The actor does filter, draft, guard and log; this process only
// moves messages. Only actor output (which passed the guard) is ever sent.
import { connect } from "../shared/relay";
import { expertAgent, feed } from "../shared/actors";
import { PROTOCOL_VERSION, type Answer, type Message } from "../shared/protocol";
import type { TeamId } from "../shared/types";
import type { AnswerBody } from "../actors/src/expert-logic";

const team = process.argv[2] as TeamId;
if (team !== "battery" && team !== "actuators" && team !== "software") {
  console.error("usage: bun bridge/expert-bridge.ts <battery|actuators|software>");
  process.exit(1);
}

const me = `expert-${team}`;
const CONSOLE = "console";
const actor = expertAgent(team);
const timeline = feed();
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 23)} [${me}] ${s}`);
const at = () => new Date().toISOString();
const answerMsg = (requestId: string, body: AnswerBody): Answer => ({ v: PROTOCOL_VERSION, kind: "answer", requestId, at: at(), ...body });

const relay = await connect(me, { log: (s) => log(`relay: ${s}`) });

// Stretch (SPEC §16 item 2), on with CONSULT=1: when this expert's answer points at another team
// ("check with Battery first"), DM that team's expert as ourselves and merge its reply. The other
// expert answers at OUR clearance (expert-actuators is public-only at Battery), so the merged part
// is safe for any asker. No new agents.
const CONSULT = process.env.CONSULT === "1";
const CONSULT_TIMEOUT_MS = 12_000;
const CONSULTS: Partial<Record<TeamId, { team: TeamId; question: string }>> = {
  actuators: {
    team: "battery",
    question: "What continuous and peak current can the pack handle?",
  },
};
const waiting = new Map<string, (a: Answer) => void>();

/** refersTo comes from the actor: the answer text OR any used entry's full text names that team. */
async function consult(original: Message & { kind: "ask" }, body: AnswerBody, refersTo: TeamId[]): Promise<AnswerBody> {
  const c = CONSULTS[team];
  if (!CONSULT || !c || (body.status !== "answered" && body.status !== "partial") || !refersTo.includes(c.team)) return body;
  const requestId = `${original.requestId}:consult-${c.team}`;
  const reply = new Promise<Answer | null>((resolve) => {
    waiting.set(requestId, resolve);
    setTimeout(() => { waiting.delete(requestId); resolve(null); }, CONSULT_TIMEOUT_MS);
  });
  await relay.send(`expert-${c.team}`, {
    v: PROTOCOL_VERSION, kind: "ask", requestId, at: at(),
    from: { agent: me, human: `${team} expert`, team }, to: c.team, question: c.question,
  });
  log(`consult ${requestId} -> expert-${c.team}`);
  const r = await reply;
  if (!r || (r.status !== "answered" && r.status !== "partial")) {
    log(`consult ${requestId}: ${r?.status ?? "timed out"}, not merged`);
    return body;
  }
  log(`consult ${requestId}: ${r.status}, merged (${r.sources.map((s) => s.id).join(",")})`);
  return {
    ...body,
    text: `${body.text}\n\nI checked with the ${c.team} expert: ${r.text}`,
    sources: [...body.sources, ...r.sources],
    // Battery's withheld hints describe what it kept from US, not from the asker: not merged.
  };
}

async function handle(msg: Message, sender: string): Promise<void> {
  switch (msg.kind) {
    case "ask": {
      if (msg.to !== team) return log(`drop ask for ${msg.to} from ${sender}`);
      const r = await actor.ask(sender, msg); // identity = Relay-stamped sender, never msg.from
      if (r.duplicate) return log(`ask ${msg.requestId} from ${sender}: replay, already handled`);
      await timeline.push(r.feed);
      await relay.send(sender, answerMsg(msg.requestId, await consult(msg, r.answer, r.refersTo ?? [])));
      log(`ask ${msg.requestId} from ${sender}: ${r.answer.status} (${r.answer.sources.map((s) => s.id).join(",") || "-"})`);
      if (r.escalation) {
        await relay.send(CONSOLE, {
          v: PROTOCOL_VERSION, kind: "escalation_notice", requestId: msg.requestId, at: at(), teamId: team, escalation: r.escalation,
        });
        log(`escalation ${r.escalation.id} -> ${CONSOLE}`);
      }
      return;
    }
    case "owner_reply": {
      if (sender !== CONSOLE) return log(`drop owner_reply from ${sender} (only ${CONSOLE} may answer)`);
      const r = await actor.ownerReply(msg);
      if (r.duplicate || !r.to || !r.answer || !r.requestId) return log(`owner_reply ${msg.escalationId}: not pending, ignored`);
      if (r.feed) await timeline.push(r.feed);
      await relay.send(r.to, answerMsg(r.requestId, r.answer));
      log(`owner_reply ${msg.escalationId} -> ${r.to} (${r.answer.status}${msg.save ? `, saved as ${msg.sensitivity}` : ""})`);
      return;
    }
    case "answer": {
      const resolve = waiting.get(msg.requestId);
      if (resolve && sender === `expert-${msg.team}`) {
        waiting.delete(msg.requestId);
        resolve(msg);
      } else log(`ignore answer ${msg.requestId} from ${sender}`);
      return;
    }
    default:
      log(`ignore ${msg.kind} from ${sender}`);
  }
}

relay.onMessage(async (msg, { sender }) => {
  try {
    await handle(msg, sender);
  } catch (err) {
    log(`error handling ${msg.kind} ${msg.requestId} from ${sender}: ${(err as Error).message}`);
  }
});

log(`listening (actor ${team})${CONSULT && CONSULTS[team] ? `, consults ${CONSULTS[team]!.team}` : ""}`);
const stop = async () => { await relay.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
