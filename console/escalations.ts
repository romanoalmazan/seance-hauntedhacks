// Open escalation cards, in memory, keyed by escalationId. See SPEC §8.
import { z } from "zod";
import { escalationNoticeSchema, ownerReplySchema, PROTOCOL_VERSION } from "../shared/protocol";
import type { Message, RelayClient } from "../shared/protocol";
import type { ConsoleActorApi, Escalation, TeamId } from "../shared/types";

export interface Card {
  escalationId: string;
  requestId: string;
  team: TeamId;
  asker: string;
  question: string;
  reason: Escalation["reason"];
}

/** What the page posts. Team, owner and requestId come from the card, never the browser. */
export const ownerReplyInput = ownerReplySchema
  .pick({ escalationId: true, save: true, sensitivity: true, tags: true })
  .extend({ text: z.string().trim().min(1) });

export type OwnerReplyInput = z.infer<typeof ownerReplyInput>;
export type ReplyResult = "sent" | "gone" | "busy";

export const TEAMS: readonly TeamId[] = ["battery", "actuators"];

const expertAgent = (team: TeamId) => `expert-${team}`;

export function createCards(relay: RelayClient, expert: (team: TeamId) => ConsoleActorApi) {
  const open = new Map<string, Card>();
  // Every id opened since Reset. Deliveries replay, so `open` alone would let a replay bring back
  // a card the owner already answered. It also carries beat 2½: while the bridge is down the
  // owner's reply waits in Relay, so the actor still says "pending" for a card already answered.
  const seen = new Set<string>();
  const sending = new Set<string>();
  let resets = 0;

  function openCard(team: TeamId, escalation: Escalation): void {
    if (seen.has(escalation.id)) return;
    seen.add(escalation.id);
    open.set(escalation.id, {
      escalationId: escalation.id,
      requestId: escalation.requestId,
      team,
      asker: escalation.asker,
      question: escalation.question,
      reason: escalation.reason,
    });
  }

  function receive(msg: Message, sender: string): void {
    if (msg.kind !== "escalation_notice") return;
    const notice = escalationNoticeSchema.safeParse(msg);
    if (!notice.success || sender !== expertAgent(notice.data.teamId)) {
      console.warn(`[console] dropped escalation_notice from ${sender}`);
      return;
    }
    openCard(notice.data.teamId, notice.data.escalation);
  }

  relay.onMessage((msg, { sender }) => receive(msg, sender));

  return {
    list: (): Card[] => [...open.values()],

    /**
     * Brings the cards in line with the actors, the source of truth for what is still open, so
     * an escalation the console missed (say, across a restart) still gets a card. The list also
     * keeps answered escalations, and those close their card instead.
     */
    async reconcile(): Promise<void> {
      const startedAt = resets;
      const views = await Promise.all(
        TEAMS.map(async (team) => ({ team, pending: (await expert(team).snapshot()).pending })),
      );
      if (startedAt !== resets) return; // A Reset ran during the read, so these ids are gone.

      for (const { team, pending } of views) {
        for (const escalation of pending) {
          if (escalation.status === "pending") {
            openCard(team, escalation);
          } else {
            seen.add(escalation.id);
            open.delete(escalation.id);
          }
        }
      }
    },

    /** The card stays open unless the send succeeds, so a failure never loses the question. */
    async reply(input: OwnerReplyInput): Promise<ReplyResult> {
      const card = open.get(input.escalationId);
      if (!card) return "gone";
      if (sending.has(card.escalationId)) return "busy";

      sending.add(card.escalationId);
      try {
        const { profile } = await expert(card.team).snapshot();
        await relay.send(expertAgent(card.team), {
          v: PROTOCOL_VERSION,
          kind: "owner_reply",
          requestId: card.requestId,
          at: new Date().toISOString(),
          escalationId: card.escalationId,
          ownerName: profile.ownerName,
          text: input.text,
          save: input.save,
          sensitivity: input.sensitivity,
          tags: input.tags,
        });
        open.delete(card.escalationId);
        return "sent";
      } finally {
        sending.delete(card.escalationId);
      }
    },

    /** Reset wipes the actors' escalations, and a fresh run may reuse the same ids. */
    clear(): void {
      resets += 1;
      open.clear();
      seen.clear();
    },
  };
}
