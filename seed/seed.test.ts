import { expect, test } from "bun:test";
import { z } from "zod";
import { parseMessage, encode } from "../shared/protocol";
import battery from "./battery.json";
import actuators from "./actuators.json";
import attacks from "./attacks.json";

const entry = z.object({
  id: z.string(), title: z.string(), tags: z.array(z.string()).min(3).max(5),
  sensitivity: z.enum(["public", "internal", "restricted"]),
  full: z.string().min(1), releasable: z.string().nullable(),
  protectedTokens: z.array(z.string()), source: z.literal("seed"),
});
const seedFile = z.object({
  profile: z.object({ teamId: z.enum(["battery", "actuators"]), displayName: z.string(), ownerName: z.string() }),
  knowledge: z.array(entry).length(5),
});

for (const [name, data] of [["battery", battery], ["actuators", actuators]] as const) {
  test(`${name} seed parses and protected tokens occur in full text`, () => {
    const seed = seedFile.parse(data);
    for (const e of seed.knowledge) {
      for (const tok of e.protectedTokens) expect(e.full).toContain(tok);
      for (const tag of e.tags) expect(tag).toBe(tag.toLowerCase());
      if (e.sensitivity === "public") expect(e.releasable).toBeNull();
      else expect(e.releasable).not.toBeNull();
      if (e.sensitivity === "restricted") expect(e.protectedTokens.length).toBeGreaterThan(0);
    }
  });
}

test("attacks has six prompts", () => {
  expect(attacks.prompts).toHaveLength(6);
});

test("protocol round-trips and rejects junk", () => {
  const ask = { v: 1, kind: "ask", requestId: "r1", at: new Date().toISOString(),
    from: { agent: "asker-priya", human: "Priya", team: "Controls" }, to: "actuators", question: "hi" } as const;
  expect(parseMessage(encode(ask))).toEqual(ask);
  expect(parseMessage("not json")).toBeNull();
  expect(parseMessage(JSON.stringify({ ...ask, v: 2 }))).toBeNull();
  expect(parseMessage(JSON.stringify({ ...ask, context: "x".repeat(301) }))).toBeNull();
});
