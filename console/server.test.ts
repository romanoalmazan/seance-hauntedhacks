import { beforeEach, describe, expect, test } from "bun:test";
import { createFakes } from "./fakes";
import { handler } from "./server";
import type { FeedEvent, Snapshot } from "../shared/types";

let fakes: ReturnType<typeof createFakes>;
let app: (req: Request) => Promise<Response>;

const get = (path: string) => app(new Request(`http://console${path}`));
const post = (path: string, body?: unknown) =>
  app(new Request(`http://console${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }));
const snapshot = async (team: string) => (await (await get(`/snapshot/${team}`)).json()) as Snapshot;
const feed = async () => (await (await get("/feed")).json()) as FeedEvent[];

const event = { team: "battery", asker: "asker-guest", question: "q?", decision: "answered" };

beforeEach(() => {
  fakes = createFakes();
  app = handler(fakes);
});

describe("reads", () => {
  test("GET / serves the page", async () => {
    const response = await get("/");
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Interruptions avoided");
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

  test("rejects a bad event and changes nothing", async () => {
    const before = (await feed()).length;
    expect((await post("/dev/event", { ...event, team: "legal" })).status).toBe(400);
    expect((await post("/dev/event", { ...event, decision: "leaked" })).status).toBe(400);
    expect((await post("/dev/event")).status).toBe(400);
    expect(await feed()).toHaveLength(before);
    expect((await snapshot("battery")).stats.asked).toBe(0);
  });

  test("does not exist without dev hooks, which is how the real actors run", async () => {
    const real = handler({ expert: fakes.expert, feed: fakes.feed });
    const response = await real(new Request("http://console/dev/event", { method: "POST", body: JSON.stringify(event) }));
    expect(response.status).toBe(404);
  });
});

describe("POST /reset", () => {
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
