// One process per team: bun bridge/expert-bridge.ts battery
// Listens on Relay as expert-<team>. The actor does filter, draft, guard and log; this process only
// moves messages. Only actor output (which passed the guard) is ever sent.
import { connect } from "../shared/relay";
import { expertAgent, feed } from "../shared/actors";
import { PROTOCOL_VERSION, type Answer, type Message } from "../shared/protocol";
import type { TeamId } from "../shared/types";
import type { AnswerBody } from "../actors/src/expert-logic";

const team = process.argv[2] as TeamId;
if (team !== "battery" && team !== "actuators") {
  console.error("usage: bun bridge/expert-bridge.ts <battery|actuators>");
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

async function handle(msg: Message, sender: string): Promise<void> {
  switch (msg.kind) {
    case "ask": {
      if (msg.to !== team) return log(`drop ask for ${msg.to} from ${sender}`);
      const r = await actor.ask(sender, msg); // identity = Relay-stamped sender, never msg.from
      if (r.duplicate) return log(`ask ${msg.requestId} from ${sender}: replay, already handled`);
      await timeline.push(r.feed);
      await relay.send(sender, answerMsg(msg.requestId, r.answer));
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

log(`listening (actor ${team})`);
const stop = async () => { await relay.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
