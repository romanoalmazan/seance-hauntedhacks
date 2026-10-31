// Shared event timeline for the console (SPEC §9). One actor, id "main".
import { Actor, Persisted } from "terse-sdk/actor";
import type { FeedEvent } from "../../shared/types.js";

const CAP = 500;

export class Feed extends Actor {
  @Persisted events: FeedEvent[] = [];

  async push(event: FeedEvent): Promise<void> {
    this.events = [...this.events, event].slice(-CAP);
  }

  async recent(n = 50): Promise<FeedEvent[]> {
    return this.events.slice(-n).reverse();
  }

  async reset(): Promise<void> {
    this.events = [];
  }
}
