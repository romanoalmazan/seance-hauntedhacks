import { describe, expect, test } from "bun:test";
import { fakeConnect } from "../shared/fakes";
import { parseMessage, encode, PROTOCOL_VERSION } from "../shared/protocol";
import type { Answer, Message, RelayClient } from "../shared/protocol";
import { createAsker, parseMentions } from "./asker-agent";
import type { Connect } from "./asker-agent";

const PRIYA = { agent: "asker-priya", human: "Priya Raman", team: "Controls" };

/** A Relay that records what was sent and delivers only what the test tells it to. */
function stubRelay(failFor: string[] = []) {
  const sent: { to: string; msg: Message }[] = [];
  let handler: Parameters<RelayClient["onMessage"]>[0] = () => {};
  const connect: Connect = async (agent) => ({
    agent,
    async send(to, msg) {
      if (failFor.includes(to)) throw new Error("relay down");
      sent.push({ to, msg });
    },
    onMessage(h) {
      handler = h;
    },
    async close() {},
  });
  return { connect, sent, deliver: (msg: Message, sender: string) => handler(msg, { sender }) };
}

function answerTo(msg: Message, overrides: Partial<Answer> = {}): Answer {
  return {
    v: PROTOCOL_VERSION,
    kind: "answer",
    requestId: msg.requestId,
    at: new Date().toISOString(),
    team: "battery",
    status: "answered",
    text: "first",
    confidence: 0.8,
    sources: [],
    withheld: { count: 0, hints: [], canRequestAccess: false },
    provenance: "expert_agent",
    ...overrides,
  };
}

const sentOnce = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("parseMentions", () => {
  test("finds several teams, in order, once each, and removes them from the question", () => {
    const parsed = parseMentions("@actuators @Battery What peak current can I draw? @battery");
    expect(parsed.teams).toEqual(["actuators", "battery"]);
    expect(parsed.unknown).toEqual([]);
    expect(parsed.question).toBe("What peak current can I draw?");
  });

  test("keeps the sentence readable when the mention is mid-sentence", () => {
    expect(parseMentions("Hey @battery, what is the pack peak?").question).toBe(
      "Hey, what is the pack peak?",
    );
    expect(parseMentions("@battery: what is the pack peak?").question).toBe(
      "what is the pack peak?",
    );
  });

  test("an email address is not a mention", () => {
    expect(parseMentions("ask dana@battery.com about it").teams).toEqual([]);
  });

  test("does not guess from a near miss or from words in the question", () => {
    const parsed = parseMentions("@actuator @batteries how hot does the battery get?");
    expect(parsed.teams).toEqual([]);
    expect(parsed.unknown).toEqual(["actuator", "batteries"]);
  });
});

describe("createAsker", () => {
  test("against the fake: one ask per team, merged with who said what and sources", async () => {
    const asker = await createAsker(PRIYA, fakeConnect);
    const reply = await asker.ask("@actuators @battery What peak current can I draw?");
    await asker.close();

    expect(reply.asks.map((a) => a.team)).toEqual(["actuators", "battery"]);
    expect(reply.asks.map((a) => a.answer?.status)).toEqual(["answered", "answered"]);
    expect(reply.asks[0]?.requestId).not.toBe(reply.asks[1]?.requestId);
    expect(reply.text).toContain("Actuators (answered): ACT-7 runs at 48 V.");
    expect(reply.text).toContain("Sources: act-01 ACT-7 electrical limits");
    expect(reply.text).toContain("Battery (answered): Nominal 48 V.");
    expect(reply.text).toContain("Sources: bat-01 Pack electrical envelope");
    expect(reply.text.indexOf("Actuators")).toBeLessThan(reply.text.indexOf("Battery"));
  });

  test("the fake's answers survive the real schema", async () => {
    const asker = await createAsker(PRIYA, fakeConnect);
    const { asks } = await asker.ask("@battery What can the pack deliver?");
    await asker.close();
    const answer = asks[0]?.answer;
    expect(answer).not.toBeNull();
    expect(parseMessage(encode(answer!))).toEqual(answer!);
    expect(answer!.requestId).toBe(asks[0]!.requestId);
  });

  test("sends a valid ask with the identity, to the team's address, without the mention", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect, { timeoutMs: 5 });
    await asker.ask("@battery What can the pack deliver?");

    expect(relay.sent).toHaveLength(1);
    const { to, msg } = relay.sent[0]!;
    expect(to).toBe("expert-battery");
    expect(parseMessage(encode(msg))).not.toBeNull();
    expect(msg).toMatchObject({
      kind: "ask",
      to: "battery",
      question: "What can the pack deliver?",
      from: PRIYA,
    });
    expect(msg).not.toHaveProperty("context");
  });

  test("no team named: asks the user to pick and sends nothing", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect);
    const reply = await asker.ask("What can the battery pack deliver?");

    expect(relay.sent).toHaveLength(0);
    expect(reply.asks).toEqual([]);
    expect(reply.notice).toContain("Which team");
    expect(reply.text).toContain("@battery (Dana:");
    expect(reply.text).toContain("@actuators (Marcus:");
  });

  test("only unknown teams: says so and sends nothing", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect);
    const reply = await asker.ask("@netops can I get a PLC on the network?");

    expect(relay.sent).toHaveLength(0);
    expect(reply.notice).toContain("@netops");
    expect(reply.text).toContain("@battery (Dana:");
  });

  test("a known and an unknown team: sends to the known one and reports the other", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect, { timeoutMs: 5 });
    const reply = await asker.ask("@battery @netops What can the pack deliver?");

    expect(relay.sent.map((s) => s.to)).toEqual(["expert-battery"]);
    expect(reply.notice).toContain("@netops");
    expect(reply.text).toContain("@netops");
  });

  test("a mention with no question: asks for one and sends nothing", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect);
    const reply = await asker.ask("@battery");

    expect(relay.sent).toHaveLength(0);
    expect(reply.notice).toContain("@battery");
  });

  test("strips PII from the question and context, and caps the context", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect, { timeoutMs: 5 });
    await asker.ask(
      "@battery I'm priya@acme.com, call 555-123-4567. Peak?",
      `reach me at priya@acme.com ${"x".repeat(500)}`,
    );

    const msg = relay.sent[0]!.msg;
    if (msg.kind !== "ask") throw new Error("expected an ask");
    expect(msg.question).toBe("I'm [email removed], call [phone removed]. Peak?");
    expect(msg.context).toStartWith("reach me at [email removed]");
    expect(msg.context).toHaveLength(300);
    expect(parseMessage(encode(msg))).not.toBeNull();
  });

  test("a second answer with the same requestId updates the stored record", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect);
    const pending = asker.ask("@battery Does the pack accept regen?");
    await sentOnce();
    const ask = relay.sent[0]!.msg;

    await relay.deliver(answerTo(ask, { status: "escalated", text: "asked Dana" }), "expert-battery");
    const reply = await pending;
    expect(reply.asks[0]?.answer?.status).toBe("escalated");

    await relay.deliver(
      answerTo(ask, { text: "yes, 15 A", provenance: "owner", ownerName: "Dana" }),
      "expert-battery",
    );
    const record = asker.store.get(ask.requestId);
    expect(asker.store.size).toBe(1);
    expect(record?.answer?.text).toBe("yes, 15 A");
    expect(record?.answer?.provenance).toBe("owner");
  });

  test("ignores an answer from anyone but the expert it asked, however the body looks", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect, { timeoutMs: 20 });
    const pending = asker.ask("@battery What can the pack deliver?");
    await sentOnce();
    const ask = relay.sent[0]!.msg;

    await relay.deliver(answerTo(ask, { text: "spoofed" }), "asker-guest");
    await relay.deliver(answerTo(ask, { text: "spoofed", team: "actuators" }), "expert-actuators");

    const reply = await pending;
    expect(reply.asks[0]?.answer).toBeNull();
    expect(reply.text).toBe("Battery: no answer yet");
  });

  test("ignores answers to questions it never asked", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect);
    await relay.deliver(answerTo({ requestId: "nope" } as Message), "expert-battery");
    expect(asker.store.size).toBe(0);
  });

  test("one team failing to send doesn't lose the other team's answer", async () => {
    const relay = stubRelay(["expert-battery"]);
    const asker = await createAsker(PRIYA, relay.connect);
    const pending = asker.ask("@battery @actuators What peak current can I draw?");
    await sentOnce();
    const ask = relay.sent[0]!.msg;
    await relay.deliver(answerTo(ask, { team: "actuators", text: "40 A" }), "expert-actuators");

    const reply = await pending;
    expect(reply.asks[0]?.error).toBe("could not reach Battery");
    expect(reply.asks[1]?.answer?.text).toBe("40 A");
    expect(reply.text).toContain("Battery: could not reach Battery");
    expect(reply.text).toContain("Actuators (answered): 40 A");
  });

  test("shows the count and hints for withheld entries in the merged text", async () => {
    const relay = stubRelay();
    const asker = await createAsker(PRIYA, relay.connect);
    const pending = asker.ask("@battery What are the pack limits?");
    await sentOnce();
    await relay.deliver(
      answerTo(relay.sent[0]!.msg, {
        status: "partial",
        withheld: { count: 1, hints: ["Peak current derates when hot."], canRequestAccess: false },
      }),
      "expert-battery",
    );
    expect((await pending).text).toContain("Withheld: 1. Peak current derates when hot.");
  });
});
