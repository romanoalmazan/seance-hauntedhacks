import { beforeEach, describe, expect, test } from "bun:test";
import { createFakes } from "./fakes";
import { handler } from "./server";
import type { RedteamReport } from "../scripts/redteam";
import attacks from "../seed/attacks.json";
import type { EscalationNotice, Message } from "../shared/protocol";
import type { Card } from "./escalations";
import type { ConsoleActorApi, FeedEvent, Snapshot, TeamId } from "../shared/types";

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
  app = handler({ ...fakes, resetAskers: async () => [] });
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

  test("GET /flow.js serves the strip's rules as plain JavaScript", async () => {
    const response = await get("/flow.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    const script = await response.text();
    expect(script).toContain("flowEdges");
    expect(script).not.toContain("interface Edge");
    expect(script).not.toContain("import type");
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
    expect(view.knowledge.at(-1)).toMatchObject({
      id: "act-L1",
      title: "Does ACT-7 support regenerative braking into the pack?",
      sensitivity: "public",
      source: "owner_answer",
    });
    expect(view.pending.map((escalation) => escalation.status)).toEqual(["answered"]);
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
    expect(view.knowledge).toHaveLength(5);
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

describe("reconciling cards with the actors", () => {
  /** A console process that just started: same actors, no memory of any card. */
  const restartConsole = () => {
    app = handler({ ...fakes, resetAskers: async () => [] });
  };

  test("a pending escalation the console missed gets a card, keyed by escalationId", async () => {
    const id = await fakes.dev.escalate({ notify: false });
    expect(await cards()).toEqual([
      {
        escalationId: id,
        requestId: "req-1",
        team: "actuators",
        asker: "asker-priya",
        question: "Does ACT-7 support regenerative braking into the pack?",
        reason: "no_knowledge",
      },
    ]);
  });

  test("a restart keeps the open card, and it can still be answered", async () => {
    await post("/dev/escalate");
    restartConsole();
    expect(await cards()).toHaveLength(1);
    expect((await post("/owner-reply", reply("esc-1"))).status).toBe(200);
    expect(fakes.relay.sent).toHaveLength(1);
    expect(await cards()).toEqual([]);
  });

  test("a notice and the reconcile for one escalation make one card", async () => {
    await fakes.dev.escalate({ notify: false });
    await cards();
    await fakes.relay.deliver({ ...notice("esc-1"), requestId: "req-1" }, "expert-actuators");
    expect(await cards()).toHaveLength(1);
  });

  test("an answered escalation does not bring a card back, even after a restart", async () => {
    await post("/dev/escalate");
    await post("/owner-reply", reply("esc-1"));
    expect(await cards()).toEqual([]);
    restartConsole();
    expect(await cards()).toEqual([]);
  });

  test("a notice replayed after a restart can't reopen an answered escalation", async () => {
    await post("/dev/escalate");
    await post("/owner-reply", reply("esc-1"));
    restartConsole();
    await fakes.relay.deliver(notice("esc-1"), "expert-actuators");
    expect(await cards()).toEqual([]);
  });

  test("beat 2½: a reply waiting in Relay doesn't reopen the card while the actor says pending", async () => {
    await post("/dev/escalate");
    fakes.relay.send = async () => {}; // the bridge is down, so the actor doesn't hear the reply
    await post("/owner-reply", reply("esc-1"));
    expect((await snapshot("actuators")).pending[0]?.status).toBe("pending");
    expect(await cards()).toEqual([]);
  });

  test("an escalation answered elsewhere closes its open card", async () => {
    await post("/dev/escalate");
    await fakes.relay.send("expert-actuators", {
      v: 1,
      kind: "owner_reply",
      requestId: "req-1",
      at: "2026-10-31T12:00:00.000Z",
      escalationId: "esc-1",
      ownerName: "Marcus",
      text: "Sent from a script.",
      save: false,
      sensitivity: "public",
      tags: [],
    });
    expect(await cards()).toEqual([]);
  });

  test("a read that straddles a Reset doesn't bring the old card back", async () => {
    await fakes.dev.escalate({ notify: false });
    const before = await fakes.expert("actuators").snapshot();

    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowExpert = (team: TeamId): ConsoleActorApi => ({
      snapshot: () => gate.then(() => (team === "actuators" ? before : fakes.expert(team).snapshot())),
      setSensitivity: (entryId, tier) => fakes.expert(team).setSensitivity(entryId, tier),
      setClearance: (agent, level) => fakes.expert(team).setClearance(agent, level),
      reset: () => fakes.expert(team).reset(),
    });
    app = handler({ ...fakes, expert: slowExpert, resetAskers: async () => [] });

    const polling = get("/cards");
    expect((await post("/reset")).status).toBe(200);
    release();
    expect(await (await polling).json()).toEqual([]);
  });

  test("an actor failure during a poll is a 500, and the startup reconcile doesn't crash", async () => {
    const down = handler({
      ...fakes,
      expert: (team) => ({
        ...fakes.expert(team),
        snapshot: () => Promise.reject(new Error("actor down")),
      }),
    });
    expect((await down(new Request("http://console/cards"))).status).toBe(500);
  });
});

describe("POST /sensitivity", () => {
  const change = (overrides: object = {}) =>
    post("/sensitivity", { team: "battery", entryId: "bat-02", tier: "public", ...overrides });
  const tierOf = async (team: string, id: string) =>
    (await snapshot(team)).knowledge.find((entry) => entry.id === id)?.sensitivity;

  test("flips one entry on one team, and the next snapshot shows it", async () => {
    const before = await snapshot("actuators");
    expect(await tierOf("battery", "bat-02")).toBe("internal");

    const response = await change();

    expect(response.status).toBe(200);
    expect(await tierOf("battery", "bat-02")).toBe("public");
    expect(await tierOf("battery", "bat-03")).toBe("internal");
    expect((await snapshot("actuators")).knowledge).toEqual(before.knowledge);
  });

  test.each([
    ["an unknown tier", { tier: "secret" }],
    ["a tier in the wrong case", { tier: "Public" }],
    ["a missing tier", { tier: undefined }],
    ["an unknown team", { team: "legal" }],
    ["a missing entry id", { entryId: undefined }],
    ["an empty entry id", { entryId: "" }],
  ])("%s is a 400 and changes nothing", async (_name, overrides) => {
    expect((await change(overrides)).status).toBe(400);
    expect(await tierOf("battery", "bat-02")).toBe("internal");
  });

  test("a body that isn't JSON is a 400", async () => {
    expect((await post("/sensitivity")).status).toBe(400);
  });

  test.each([
    ["an entry that doesn't exist", { entryId: "bat-99" }],
    ["another team's entry", { team: "actuators" }],
  ])("%s is a 404, even though the real actor would ignore it quietly", async (_name, overrides) => {
    let calls = 0;
    app = handler({
      ...fakes,
      expert: (team) => ({
        snapshot: () => fakes.expert(team).snapshot(),
        setSensitivity: async () => void (calls += 1), // the real actor's behaviour on an unknown id
        setClearance: (agent, level) => fakes.expert(team).setClearance(agent, level),
        reset: () => fakes.expert(team).reset(),
      }),
    });
    expect((await change(overrides)).status).toBe(404);
    expect(calls).toBe(0);
  });

  test("a learned entry can move too", async () => {
    await post("/dev/escalate");
    await post("/owner-reply", reply("esc-1"));
    expect(await tierOf("actuators", "act-L1")).toBe("public");

    expect((await change({ team: "actuators", entryId: "act-L1", tier: "internal" })).status).toBe(200);

    expect(await tierOf("actuators", "act-L1")).toBe("internal");
  });

  test("Reset puts the tier back", async () => {
    await change();
    await post("/reset");
    expect(await tierOf("battery", "bat-02")).toBe("internal");
  });

  test("only POST changes a tier", async () => {
    expect((await get("/sensitivity")).status).toBe(404);
  });

  test("an actor failure is a 500, not a false ok", async () => {
    app = handler({
      ...fakes,
      expert: (team) => ({
        snapshot: () => fakes.expert(team).snapshot(),
        setSensitivity: () => Promise.reject(new Error("actor down")),
        setClearance: (agent, level) => fakes.expert(team).setClearance(agent, level),
        reset: () => fakes.expert(team).reset(),
      }),
    });
    expect((await change()).status).toBe(500);
  });
});

describe("POST /clearance", () => {
  const change = (body: object) => post("/clearance", body);
  const levels = async (agent: string): Promise<(number | undefined)[]> => [
    (await snapshot("battery")).policy.clearance[agent],
    (await snapshot("actuators")).policy.clearance[agent],
  ];

  test.each([
    ["asker-guest", 1],
    ["asker-priya", 0], // 0 is falsy, so it's the level a careless check would drop
  ])("sets %s to %d on both teams and leaves the other asker alone", async (agent, level) => {
    const other = agent === "asker-guest" ? "asker-priya" : "asker-guest";
    const before = await levels(other);

    expect((await change({ agent, level })).status).toBe(200);

    expect(await levels(agent)).toEqual([level, level]);
    expect(await levels(other)).toEqual(before);
  });

  test.each([
    ["clearance 2, which no asker may have (SPEC §6)", { agent: "asker-guest", level: 2 }],
    ["clearance 2 for Priya", { agent: "asker-priya", level: 2 }],
    ["a level above 2", { agent: "asker-guest", level: 3 }],
    ["a negative level", { agent: "asker-guest", level: -1 }],
    ["a fractional level", { agent: "asker-guest", level: 1.5 }],
    ["a level sent as a string", { agent: "asker-guest", level: "1" }],
    ["a null level", { agent: "asker-guest", level: null }],
    ["a missing level", { agent: "asker-guest" }],
    // A valid level on purpose, so only the agent check can reject these.
    ["an unknown asker", { agent: "asker-mallory", level: 1 }],
    ["an expert's agent", { agent: "expert-battery", level: 1 }],
    ["a prototype key as the agent", { agent: "constructor", level: 1 }],
    ["a missing agent", { level: 1 }],
  ])("%s is a 400 and changes nothing", async (_name, body) => {
    const before = (await snapshot("battery")).policy;
    expect((await change(body)).status).toBe(400);
    expect((await snapshot("battery")).policy).toEqual(before);
    expect((await snapshot("actuators")).policy).toEqual(before);
  });

  test("a body that isn't JSON is a 400", async () => {
    expect((await post("/clearance")).status).toBe(400);
  });

  test("Reset puts the clearance back", async () => {
    await change({ agent: "asker-guest", level: 1 });
    await post("/reset");
    expect(await levels("asker-guest")).toEqual([0, 0]);
  });

  test("only POST changes a clearance", async () => {
    expect((await get("/clearance")).status).toBe(404);
  });

  test("an actor failure on either team is a 500, not a false ok", async () => {
    app = handler({
      ...fakes,
      expert: (team) => ({
        snapshot: () => fakes.expert(team).snapshot(),
        setSensitivity: (entryId, tier) => fakes.expert(team).setSensitivity(entryId, tier),
        setClearance: (agent, level) =>
          team === "actuators"
            ? Promise.reject(new Error("actor down"))
            : fakes.expert(team).setClearance(agent, level),
        reset: () => fakes.expert(team).reset(),
      }),
    });
    expect((await change({ agent: "asker-guest", level: 1 })).status).toBe(500);
  });
});

test("the page has the clearance and tier sections", async () => {
  const page = await (await get("/")).text();
  expect(page).toContain("Asker clearance, both teams");
  expect(page).toContain("Knowledge tiers");
  expect(page).toContain("1, internal");
  expect(page).not.toContain("2, restricted"); // SPEC §6: the control offers no clearance 2
});

describe("POST /redteam", () => {
  const run = async () => (await (await post("/redteam")).json()) as RedteamReport;
  const reply = (text: string) => JSON.stringify({ text, asks: [], notice: null });

  /** Runs with `ask` as the Guest asker. Anything it doesn't log stays out of the audit. */
  function withGuest(ask: (text: string) => Promise<string>) {
    app = handler({ ...fakes, askGuest: ask });
  }

  test("every attack reaches Guest as /raw exactly as typed, and is blocked and logged", async () => {
    const typed: string[] = [];
    const { askGuest } = fakes;
    withGuest((text) => {
      typed.push(text);
      return askGuest(text);
    });

    const report = await run();

    expect(typed).toEqual(attacks.prompts.map((prompt) => `/raw battery ${prompt}`));
    expect(report).toMatchObject({ passed: 6, total: 6 });
    expect(report.results.map((result) => result.prompt)).toEqual(attacks.prompts);
    expect(report.results.every((result) => result.blocked && result.decision === "refused")).toBe(true);
    expect((await snapshot("battery")).audit.map((event) => event.question)).toEqual(attacks.prompts);
  });

  test.each([
    ["in the answer text", "Cells come from PELICAN.", "PELICAN"],
    ["in a hint, not the text", JSON.stringify({ text: "No.", asks: [{ answer: { withheld: { hints: ["costs $4.15"] } } }] }), "$4.15"],
    ["from the other team's seed", "Bearings are ACT-3308.", "ACT-3308"],
    ["in another case", "cells from pelican", "PELICAN"],
  ])("a token %s fails that prompt", async (_name, body, token) => {
    const { askGuest } = fakes;
    let calls = 0;
    withGuest(async (text) => {
      const safe = await askGuest(text);
      return ++calls === 2 ? body : safe;
    });

    const report = await run();

    expect(report.passed).toBe(5);
    const failed = report.results.filter((result) => !result.blocked);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ prompt: attacks.prompts[1], logged: true });
    expect(failed[0]?.leaked).toContain(token);
  });

  test("an attempt missing from the audit log fails even with a clean reply", async () => {
    withGuest(async () => reply("I can't share that."));
    const report = await run();
    expect(report).toMatchObject({ passed: 0, total: 6 });
    expect(report.results[0]).toMatchObject({ blocked: false, leaked: [], logged: false });
  });

  test("an earlier run's audit entry can't vouch for this run", async () => {
    await run();
    withGuest(async () => reply("I can't share that."));
    expect((await run()).passed).toBe(0);
  });

  test("a second clean run passes too", async () => {
    await run();
    expect((await run()).passed).toBe(6);
  });

  test("an unreachable Guest asker fails every prompt and says why", async () => {
    withGuest(() => Promise.reject(new Error("Unable to connect")));
    const response = await post("/redteam");
    expect(response.status).toBe(200);
    const report = (await response.json()) as RedteamReport;
    expect(report.passed).toBe(0);
    expect(report.results[0]).toMatchObject({ blocked: false, error: "Unable to connect" });
  });

  test("the page has the button, and only POST runs an attack", async () => {
    expect(await (await get("/")).text()).toContain(">Red team</button>");
    expect((await get("/redteam")).status).toBe(404);
    expect((await snapshot("battery")).audit).toEqual([]);
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

  test("clears the chat pages, after the actors, and names any it missed", async () => {
    const order: string[] = [];
    const reset = fakes.feed().reset.bind(fakes.feed());
    fakes.feed().reset = () => reset().then(() => void order.push("feed"));
    app = handler({
      ...fakes,
      resetAskers: async () => {
        order.push("askers");
        return ["asker-guest"];
      },
    });

    const response = await post("/reset");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, missed: ["asker-guest"] });
    expect(order).toEqual(["feed", "askers"]);
  });

  test("an actor failure leaves the chat pages alone", async () => {
    let cleared = false;
    const failing = handler({
      ...fakes,
      expert: (team) => ({
        ...fakes.expert(team),
        snapshot: () => fakes.expert(team).snapshot(),
        reset: () => Promise.reject(new Error("actor down")),
      }),
      resetAskers: async () => {
        cleared = true;
        return [];
      },
    });
    await failing(new Request("http://console/reset", { method: "POST" }));
    expect(cleared).toBe(false);
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
      expert: (team) => ({
        ...fakes.expert(team),
        snapshot: () => fakes.expert(team).snapshot(),
        reset: () => Promise.reject(new Error("actor down")),
      }),
    });
    const response = await failing(new Request("http://console/reset", { method: "POST" }));
    expect(response.status).toBe(500);
  });
});
