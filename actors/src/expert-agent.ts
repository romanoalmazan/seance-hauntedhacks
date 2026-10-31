// Terse shell over expert-logic.ts (SPEC §9). One actor per team; the actor id is the teamId.
// Every mutation goes through a pure function and the result is reassigned field by field,
// because a persisted array only saves on reassignment.
import { Actor, Interleave, Persisted } from "terse-sdk/actor";
import type { Clearance, Snapshot, Tier } from "./vendor/shared/types.js";
import type { Ask, OwnerReply } from "./vendor/shared/protocol.js";
import { draft, fakeDraft } from "./vendor/engine/llm.js";
import battery from "./vendor/seed/battery.json" with { type: "json" };
import actuators from "./vendor/seed/actuators.json" with { type: "json" };
import software from "./vendor/seed/software.json" with { type: "json" };
import * as L from "./expert-logic.js";

const SEEDS: Record<string, L.SeedFile> = {
  battery: battery as L.SeedFile,
  actuators: actuators as L.SeedFile,
  software: software as L.SeedFile,
};

function initial(id: string): L.ExpertState {
  const s = SEEDS[id];
  if (!s) throw new Error(`no seed for actor id "${id}" (expected battery or actuators)`);
  return L.fromSeed(s);
}

// Module functions, not methods: the Terse runtime treats every method as RPC and requires it async.
function read(a: ExpertAgent): L.ExpertState {
  return {
    profile: a.profile, knowledge: a.knowledge, policy: a.policy, pending: a.pending,
    audit: a.audit, stats: a.stats, handled: a.handled,
  };
}

function write(a: ExpertAgent, s: L.ExpertState): void {
  a.profile = s.profile;
  a.knowledge = s.knowledge;
  a.policy = s.policy;
  a.pending = s.pending;
  a.audit = s.audit;
  a.stats = s.stats;
  a.handled = s.handled;
}

export class ExpertAgent extends Actor {
  @Persisted profile: Snapshot["profile"] = initial(this.id).profile;
  @Persisted knowledge: Snapshot["knowledge"] = initial(this.id).knowledge;
  @Persisted policy: Snapshot["policy"] = initial(this.id).policy;
  @Persisted pending: Snapshot["pending"] = [];
  @Persisted audit: Snapshot["audit"] = [];
  @Persisted stats: Snapshot["stats"] = initial(this.id).stats;
  @Persisted handled: L.ExpertState["handled"] = [];

  async seed(): Promise<void> {
    write(this, initial(this.id));
  }

  async reset(): Promise<void> {
    write(this, initial(this.id));
  }

  async snapshot(): Promise<Snapshot> {
    return L.snapshot(read(this));
  }

  async setSensitivity(entryId: string, tier: Tier): Promise<void> {
    write(this, L.setSensitivity(read(this), entryId, tier));
  }

  async setClearance(agent: string, level: Clearance): Promise<void> {
    write(this, L.setClearance(read(this), agent, level));
  }

  /**
   * prepare -> model draft -> guard/decide/log, all inside the actor, so text never leaves it.
   * `sender` is the Relay-stamped agent name; the bridge passes it, never anything from the body.
   * @Interleave lets other calls run during the model call; finalize runs on the state as it is
   * after the await, and re-checks requestId, so concurrent calls can't clobber each other.
   */
  @Interleave
  async ask(sender: string, ask: Ask): Promise<L.AskResult> {
    const p = L.prepare(read(this), sender, ask);
    let d = null;
    if (p.needsDraft) {
      try {
        d = await draft(p.question, p.context, p.visible, undefined, this.profile.displayName);
      } catch (err) {
        // draft() already retries and falls back; this is a last resort. Never escalate on a model failure.
        console.error("[expert] draft failed, using the deterministic drafter:", (err as Error).message);
        d = fakeDraft(p.visible);
      }
    }
    const { state, result } = L.finalize(read(this), sender, ask, d);
    write(this, state);
    return result;
  }

  /** The owner documents something directly (console "Teach your agent"). Saved as internal; team boxes decide who sees it. */
  async teach(input: L.TeachInput): Promise<string> {
    const { state, id } = L.teach(read(this), input);
    write(this, state);
    return id;
  }

  /** Console team boxes: give every agent of a group clearance 1 (allowed) or 0 on this expert. */
  async setGroupAccess(agents: string[], allowed: boolean): Promise<void> {
    let s = read(this);
    for (const a of agents) s = L.setClearance(s, a, allowed ? 1 : 0);
    write(this, s);
  }

  async ownerReply(reply: OwnerReply): Promise<L.OwnerReplyResult> {
    const { state, result } = L.ownerReply(read(this), reply);
    write(this, state);
    return result;
  }
}
