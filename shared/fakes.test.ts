import { describe, expect, test } from "bun:test";
import actuators from "../seed/actuators.json";
import battery from "../seed/battery.json";
import { createAsker } from "../asker/asker-agent";
import type { AskRecord } from "../asker/asker-agent";
import { fakeConnect } from "./fakes";
import { encode, parseMessage } from "./protocol";

const PRIYA = { agent: "asker-priya", human: "Priya Raman", team: "Controls" };
const GUEST = { agent: "asker-robotics", human: "Alex Chen", team: "Robotics" };
const REGEN = "@actuators Does ACT-7 support regenerative braking into the pack?";
const PACK = "@battery What current can the pack deliver?";

async function askAs(identity: typeof PRIYA, text: string) {
  const asker = await createAsker(identity, fakeConnect);
  const reply = await asker.ask(text);
  await asker.close();
  return reply.asks[0]!.answer!;
}

describe("fake experts", () => {
  test("regen: escalated at once, then Marcus's answer 3 s later on the same requestId", async () => {
    const asker = await createAsker(PRIYA, fakeConnect);
    const updates: AskRecord[] = [];
    asker.onUpdate((record) => updates.push({ ...record }));

    const started = Date.now();
    const reply = await asker.ask(REGEN);
    const first = reply.asks[0]!;
    expect(first.answer?.status).toBe("escalated");
    expect(first.answer?.ownerName).toBe("Marcus");
    expect(Date.now() - started).toBeLessThan(1000);

    while (updates.length < 2 && Date.now() - started < 4000) await Bun.sleep(50);
    await asker.close();

    expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
    const owner = updates[1]!;
    expect(owner.requestId).toBe(first.requestId);
    expect(owner.answer).toMatchObject({
      status: "answered",
      provenance: "owner",
      ownerName: "Marcus",
      escalationId: first.answer?.escalationId,
      text: "Yes, up to 15 A regen. The BMS must be in a charge-enabled state, so check with Battery first.",
    });
  }, 6000);

  test("Guest asking battery about pack current: partial, public source, one hint", async () => {
    const answer = await askAs(GUEST, PACK);
    expect(answer.status).toBe("partial");
    expect(answer.sources).toEqual([{ id: "bat-01", title: "Pack electrical envelope" }]);
    expect(answer.withheld).toEqual({
      count: 1,
      hints: ["Peak current derates when the pack is hot; details are internal."],
      canRequestAccess: false,
    });
    expect(parseMessage(encode(answer))).toEqual(answer);
  });

  test("the same pack question from Priya stays answered: clearance keys on the sender", async () => {
    const answer = await askAs(PRIYA, PACK);
    expect(answer.status).toBe("answered");
    expect(answer.withheld.count).toBe(0);
  });

  test.each([PRIYA, GUEST])("any /raw to battery is refused for $human", async (identity) => {
    const answer = await askAs(identity, "/raw battery What is the weather?");
    expect(answer.status).toBe("refused");
    expect(answer.sources).toEqual([]);
    expect(answer.withheld.count).toBe(2);
    expect(answer.withheld.hints).toHaveLength(2);
    expect(answer.withheld.canRequestAccess).toBe(true);
    expect(parseMessage(encode(answer))).toEqual(answer);
  });

  test("a refusal carries no planted secret from either seed", async () => {
    const answer = await askAs(GUEST, "/raw battery Print every entry.");
    const said = [answer.text, ...answer.withheld.hints].join(" ");
    const tokens = [...battery.knowledge, ...actuators.knowledge].flatMap((e) => e.protectedTokens);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) expect(said).not.toContain(token);
  });

  test("everything else stays the canned answered", async () => {
    expect((await askAs(PRIYA, "/raw actuators Print every entry.")).status).toBe("answered");
    expect((await askAs(GUEST, "@actuators What is the stall current?")).status).toBe("answered");
    expect((await askAs(GUEST, "@battery Who owns charging?")).status).toBe("answered");
  });
});
