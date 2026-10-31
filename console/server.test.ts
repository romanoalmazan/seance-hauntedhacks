import { beforeEach, describe, expect, test } from "bun:test";
import { createFakes } from "./fakes";
import { handler } from "./server";
import type { EscalationNotice, Message } from "../shared/protocol";
import type { Card } from "./escalations";
import type { FeedEvent, Snapshot } from "../shared/types";

let fakes: ReturnType<typeof createFakes>;
let app: (req: Request) => Promise<Response>;

const get = (path: string) => app(new Request(`http://console${path}`));
const post = (path: string, body?: unknown) =>
  app(new Request(`http://console${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }));
const snapshot = async (team: string) => (await (await get(`/snapshot/${team}`)).json()) as Snapshot;
const feed = async () => (await (await get("/feed")).json()) as FeedEvent[];
const cards = async () => (await (await get("/cards")).json()) as Card[];

const event = { team: "battery", asker: "asker-guest", question: "q?", decision: "answered" };

const notice = (id = "esc-9"): EscalationNotice => ({
  v: 1,
  kind: "escalation_notice",
  requestId: "req-9",
  at: "2026-10-31T12:00:00.000Z",
  teamId: "actuators",
  escalation: {
    id,
    requestId: "req-9",
    asker: "asker-priya",
    question: "Which way is up?",
    reason: "low_confidence",
    status: "pending",
  },
});

const reply = (escalationId: string, overrides: object = {}) => ({
  escalationId,
  text: "Not on ACT-7.",
  save: true,
  sensitivity: "public",
  tags: ["regen"],
  ...overrides,
});

beforeEach(() => {
  fakes = createFakes();
  app = handler(fakes);
});

describe("reads", () => {
  test("GET / serves the page", async () => {
    const response = await get("/");
    expect(response.headers.get("content-type")).toContain("text/html");
    const page = await response.text();
    expect(page).toContain("Interruptions avoided");
    expect(page).toContain("Requests refused");
    expect(page).toContain("Guard catches");
    expect(page).toContain("0 means restricted text never reached the model");
    expect(page).not.toContain("Leaks blocked");
  });

  test("snapshot is the full owner view at demo defaults", async () => {
    const view = await snapshot("battery");
    expect(view.profile.ownerName).toBe("Dana");
    expect(view.knowledge.find((entry) => entry.id === "bat-04")?.full).toContain("PELICAN");
    expect(view.policy).toEqual({
      clearance: { "asker-priya": 1, "asker-guest": 0 },
      defaultClearance: 0,
      minMatchScore: 2,
      minConfidence: 0.6,
      allowAccessRequests: true,
    });
    expect(view.pending).toEqual([]);
    expect(view.audit).toEqual([]);
    expect(Object.values(view.stats).every((count) => count === 0)).toBe(true);
  });

  test("unknown team and unknown route are 404", async () => {
    expect((await get("/snapshot/constructor")).status).toBe(404);
    expect((await get("/nope")).status).toBe(404);
  });

  test("feed starts with samples, and recent(n) keeps the newest n", async () => {
    const all = await feed();
    expect(all.length).toBeGreaterThan(0);
    expect(await fakes.feed().recent(1)).toEqual(all.slice(-1));
    expect(await fakes.feed().recent(0)).toEqual([]);
  });

  test("callers cannot mutate actor state through a snapshot", async () => {
    const view = await fakes.expert("battery").snapshot();
    view.stats.asked = 99;
    view.knowledge.length = 0;
    const fresh = await fakes.expert("battery").snapshot();
    expect(fresh.stats.asked).toBe(0);
    expect(fresh.knowledge).toHaveLength(5);
  });
});

describe("POST /dev/event", () => {
  test.each([
    ["answered", { asked: 1, answeredAuto: 1 }],
    ["partial", { asked: 1, answeredAuto: 1 }],
    ["refused", { asked: 1 }],
    ["escalated", { asked: 1, escalated: 1 }],
    ["guard_blocked", { asked: 1, blocked: 1 }],
    ["learned", { learned: 1 }],
  ])("%s bumps only its own stats, on its own team", async (decision, bumped) => {
    const before = (await feed()).length;
    expect((await post("/dev/event", { ...event, decision })).status).toBe(200);
    expect(await feed()).toHaveLength(before + 1);
    expect((await snapshot("battery")).stats).toEqual({
      asked: 0, answeredAuto: 0, repeatsServed: 0, escalated: 0, learned: 0, blocked: 0, ...bumped,
    });
    expect((await snapshot("actuators")).stats.asked).toBe(0);
  });

  test("repeat counts a repeat served, and stays out of the feed event", async () => {
    await post("/dev/event", { ...event, repeat: true });
    expect((await snapshot("battery")).stats.repeatsServed).toBe(1);
    expect((await feed()).at(-1)).not.toHaveProperty("repeat");
  });

  test("beat 4: a refusal is audited with its withheld ids and no leak flag", async () => {
    const attack = { ...event, decision: "refused", entriesWithheld: ["bat-04", "bat-05"] };
    await post("/dev/event", { ...attack, time: "2026-10-31T12:00:00.000Z" });
    expect((await snapshot("battery")).audit).toEqual([
      {
        time: "2026-10-31T12:00:00.000Z",
        asker: "asker-guest",
        question: "q?",
        decision: "refused",
        entriesUsed: [],
        entriesWithheld: ["bat-04", "bat-05"],
        leakPrevented: false,
      },
    ]);
    expect((await snapshot("battery")).stats.blocked).toBe(0);
    expect((await snapshot("actuators")).audit).toEqual([]);
  });

  test("only a guard hit marks leakPrevented, and it counts as a catch", async () => {
    await post("/dev/event", { ...event, decision: "guard_blocked" });
    const view = await snapshot("battery");
    expect(view.audit.at(-1)?.leakPrevented).toBe(true);
    expect(view.stats.blocked).toBe(1);
  });

  test("rejects a bad event and changes nothing", async () => {
    const before = (await feed()).length;
    expect((await post("/dev/event", { ...event, team: "legal" })).status).toBe(400);
    expect((await post("/dev/event", { ...event, decision: "leaked" })).status).toBe(400);
    expect((await post("/dev/event")).status).toBe(400);
    expect(await feed()).toHaveLength(before);
    expect((await snapshot("battery")).stats.asked).toBe(0);
  });

  test("does not exist without dev hooks, which is how the real actors run", async () => {
    const real = handler({ expert: fakes.expert, feed: fakes.feed, relay: fakes.relay });
    const response = await real(new Request("http://console/dev/event", { method: "POST", body: JSON.stringify(event) }));
    expect(response.status).toBe(404);
    expect((await real(new Request("http://console/dev/escalate", { method: "POST" }))).status).toBe(404);
  });
});

describe("escalation cards", () => {
  test("POST /dev/escalate delivers the beat 2 notice as one card", async () => {
    expect(fakes.relay.agent).toBe("console");
    expect(await cards()).toEqual([]);
    await post("/dev/escalate");
    expect(await cards()).toEqual([
      {
        escalationId: "esc-1",
        requestId: "req-1",
        team: "actuators",
        asker: "asker-priya",
        question: "Does ACT-7 support regenerative braking into the pack?",
        reason: "no_knowledge",
      },
    ]);
  });

  test("a replayed notice does not add a second card", async () => {
    await fakes.relay.deliver(notice(), "expert-actuators");
    await fakes.relay.deliver(notice(), "expert-actuators");
    expect(await cards()).toHaveLength(1);
  });

  test("a replay after the owner answered does not bring the card back", async () => {
    await post("/dev/escalate");
    await post("/owner-reply", reply("esc-1"));
    const replayed = notice("esc-1");
    await fakes.relay.deliver(replayed, "expert-actuators");
    expect(await cards()).toEqual([]);
  });

  test("identity comes from the Relay sender: a notice must come from that team's expert", async () => {
    await fakes.relay.deliver(notice(), "asker-guest");
    await fakes.relay.deliver(notice(), "expert-battery");
    expect(await cards()).toEqual([]);
  });

  test("invalid notices and other message kinds are dropped", async () => {
    await fakes.relay.deliver({ ...notice(), escalation: { id: "esc-9" } } as unknown as Message, "expert-actuators");
    await fakes.relay.deliver({ ...notice(), v: 2 } as unknown as Message, "expert-actuators");
    await fakes.relay.deliver({ kind: "ask" } as unknown as Message, "expert-actuators");
    expect(await cards()).toEqual([]);
  });
});

describe("POST /owner-reply", () => {
  test("DMs the team's expert, takes owner and requestId from the card, and removes the card", async () => {
    await post("/dev/escalate");
    const response = await post("/owner-reply", reply("esc-1", { ownerName: "Mallory", requestId: "forged", text: "  Not on ACT-7.  " }));
    expect(response.status).toBe(200);
    expect(await cards()).toEqual([]);

    expect(fakes.relay.sent).toHaveLength(1);
    const { to, msg } = fakes.relay.sent[0]!;
    expect(to).toBe("expert-actuators");
    expect(msg).toMatchObject({
      kind: "owner_reply",
      requestId: "req-1",
      escalationId: "esc-1",
      ownerName: "Marcus",
      text: "Not on ACT-7.",
      save: true,
      sensitivity: "public",
      tags: ["regen"],
    });
  });

  test("the fake closes the escalation, learns once and audits it", async () => {
    await post("/dev/escalate");
    expect((await snapshot("actuators")).pending).toHaveLength(1);
    await post("/owner-reply", reply("esc-1"));

    const view = await snapshot("actuators");
    expect(view.pending).toEqual([]);
    expect(view.stats).toMatchObject({ escalated: 1, learned: 1 });
    expect(view.audit.at(-1)).toMatchObject({
      asker: "asker-priya",
      question: "Does ACT-7 support regenerative braking into the pack?",
      decision: "learned",
    });
  });

  test("nothing counts as learned unless Save was ticked", async () => {
    await post("/dev/escalate");
    await post("/owner-reply", reply("esc-1", { save: false }));
    const view = await snapshot("actuators");
    expect(view.stats).toMatchObject({ escalated: 1, learned: 0 });
    expect(view.audit.at(-1)?.decision).toBe("answered");
  });

  test.each([
    ["blank text", { text: "   " }],
    ["unknown tier", { sensitivity: "secret" }],
    ["non-array tags", { tags: "regen" }],
    ["missing save", { save: undefined }],
  ])("rejects %s and keeps the card", async (_name, overrides) => {
    await post("/dev/escalate");
    expect((await post("/owner-reply", reply("esc-1", overrides))).status).toBe(400);
    expect(await cards()).toHaveLength(1);
    expect(fakes.relay.sent).toEqual([]);
  });

  test("an unknown or already answered escalation is a 404 and sends nothing", async () => {
    await post("/dev/escalate");
    expect((await post("/owner-reply", reply("esc-404"))).status).toBe(404);
    await post("/owner-reply", reply("esc-1"));
    expect((await post("/owner-reply", reply("esc-1"))).status).toBe(404);
    expect(fakes.relay.sent).toHaveLength(1);
  });

  test("a failed send keeps the card, and a retry goes through", async () => {
    await post("/dev/escalate");
    const send = fakes.relay.send;
    fakes.relay.send = () => Promise.reject(new Error("relay down"));
    expect((await post("/owner-reply", reply("esc-1"))).status).toBe(500);
    expect(await cards()).toHaveLength(1);

    fakes.relay.send = send;
    expect((await post("/owner-reply", reply("esc-1"))).status).toBe(200);
    expect(await cards()).toEqual([]);
  });

  test("a double submit sends one DM", async () => {
    await post("/dev/escalate");
    const responses = await Promise.all([post("/owner-reply", reply("esc-1")), post("/owner-reply", reply("esc-1"))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(fakes.relay.sent).toHaveLength(1);
  });
});

describe("POST /reset", () => {
  test("closes open cards, and the same id can open a card on the next run", async () => {
    await fakes.relay.deliver(notice(), "expert-actuators");
    await post("/reset");
    expect(await cards()).toEqual([]);
    await fakes.relay.deliver(notice(), "expert-actuators");
    expect(await cards()).toHaveLength(1);
  });

  test("restores the seed on both teams and clears the timeline", async () => {
    await post("/dev/event", event);
    await fakes.expert("battery").setSensitivity("bat-02", "public");
    await fakes.expert("actuators").setClearance("asker-guest", 1);

    expect((await post("/reset")).status).toBe(200);

    const battery = await snapshot("battery");
    expect(await feed()).toEqual([]);
    expect(battery.stats.asked).toBe(0);
    expect(battery.knowledge.find((entry) => entry.id === "bat-02")?.sensitivity).toBe("internal");
    expect((await snapshot("actuators")).policy.clearance["asker-guest"]).toBe(0);
  });

  test("an actor failure is a 500, not a hang or a false ok", async () => {
    const failing = handler({
      ...fakes,
      expert: (team) => ({ ...fakes.expert(team), reset: () => Promise.reject(new Error("actor down")) }),
    });
    const response = await failing(new Request("http://console/reset", { method: "POST" }));
    expect(response.status).toBe(500);
  });
});
