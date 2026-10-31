import { describe, expect, test } from "bun:test";
import { CONSOLE, RELAY, eventKey, flowCaption, flowEdges, refusedNode, type Edge } from "./flow";
import type { EventKind, FeedEvent } from "../shared/types";

const event = (decision: EventKind, overrides: Partial<FeedEvent> = {}): FeedEvent => ({
  time: "2026-10-31T12:00:00.000Z",
  team: "actuators",
  asker: "asker-priya",
  question: "Does ACT-7 support regenerative braking into the pack?",
  decision,
  ...overrides,
});

/** edges a, b, c written as the nodes they walk: [a.from, a.to, b.to, c.to]. */
const walk = (edges: Edge[]) => [edges[0]!.from, ...edges.map(({ to }) => to)];

const EXCHANGE = ["asker-priya", RELAY, "expert-actuators", RELAY, "asker-priya"];

describe("flowEdges", () => {
  test.each(["answered", "partial", "refused", "guard_blocked"] as const)("%s goes there and back", (decision) => {
    expect(walk(flowEdges(event(decision)))).toEqual(EXCHANGE);
  });

  test("uses the event's own team and asker", () => {
    expect(walk(flowEdges(event("answered", { team: "battery", asker: "asker-guest" })))).toEqual([
      "asker-guest", RELAY, "expert-battery", RELAY, "asker-guest",
    ]);
  });

  test("escalated also carries the expert to the console, after the reply to the asker", () => {
    expect(flowEdges(event("escalated")).map(({ from, to }) => [from, to])).toEqual([
      ["asker-priya", RELAY],
      [RELAY, "expert-actuators"],
      ["expert-actuators", RELAY],
      [RELAY, "asker-priya"],
      ["expert-actuators", RELAY],
      [RELAY, CONSOLE],
    ]);
  });

  test("learned starts at the console and ends at the asker", () => {
    expect(walk(flowEdges(event("learned")))).toEqual([CONSOLE, RELAY, "expert-actuators", RELAY, "asker-priya"]);
  });

  test("a consult runs expert to expert through Relay and back", () => {
    const consult = event("partial", { team: "battery", asker: "expert-actuators" });
    expect(walk(flowEdges(consult))).toEqual([
      "expert-actuators", RELAY, "expert-battery", RELAY, "expert-actuators",
    ]);
    expect(flowCaption(consult)).toBe("expert-actuators to expert-battery: partial");
  });
});

describe("refusedNode", () => {
  test("marks the team's expert for refused and guard_blocked only", () => {
    expect(refusedNode(event("refused", { team: "battery" }))).toBe("expert-battery");
    expect(refusedNode(event("guard_blocked"))).toBe("expert-actuators");
    for (const decision of ["answered", "partial", "escalated", "learned"] as const) {
      expect(refusedNode(event(decision))).toBeNull();
    }
  });
});

describe("flowCaption", () => {
  test("names the asker, the expert and the decision", () => {
    expect(flowCaption(event("answered"))).toBe("asker-priya to expert-actuators: answered");
  });

  test("a learned entry starts from the console", () => {
    expect(flowCaption(event("learned"))).toBe("console to expert-actuators: learned");
  });

  test("spells guard_blocked in words", () => {
    expect(flowCaption(event("guard_blocked"))).toBe("asker-priya to expert-actuators: guard blocked");
  });
});

describe("eventKey", () => {
  test("is stable for the same event", () => {
    expect(eventKey(event("answered"))).toBe(eventKey(event("answered")));
  });

  test("tells apart the two rows of a two-team ask in the same millisecond", () => {
    expect(eventKey(event("answered", { team: "battery" }))).not.toBe(eventKey(event("answered")));
  });

  test("tells apart different times, askers and questions", () => {
    const base = eventKey(event("answered"));
    expect(eventKey(event("answered", { time: "2026-10-31T12:00:01.000Z" }))).not.toBe(base);
    expect(eventKey(event("answered", { asker: "asker-guest" }))).not.toBe(base);
    expect(eventKey(event("answered", { question: "Another?" }))).not.toBe(base);
  });
});
