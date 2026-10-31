import { describe, expect, test } from "bun:test";
import { MAX_CONTEXT_CHARS, sanitizeContext, stripPii } from "./sanitize";

describe("stripPii", () => {
  test.each([
    "priya@acme.com",
    "priya.raman+controls@mail.acme-robotics.co.uk",
  ])("removes email %s", (email) => {
    expect(stripPii(`mail ${email}, thanks`)).toBe("mail [email removed], thanks");
  });

  test.each([
    "555-123-4567",
    "555.123.4567",
    "555 123 4567",
    "(555) 123-4567",
    "5551234567",
    "1-555-123-4567",
    "+1 (555) 123-4567",
    "+44 20 7946 0958",
  ])("removes phone %s", (phone) => {
    expect(stripPii(`call ${phone}.`)).toBe("call [phone removed].");
  });

  test.each([
    "Peak 60 A for up to 10 s below 40 °C.",
    "ACT-7 runs at 48 V on the 2027 contract.",
    "Ref BAT-7741 and ACT-9120, yield 91.3% at $4.15.",
    "Dates like 2026-10-31 stay.",
    "@actuators @battery What peak current can I draw?",
  ])("leaves engineering text alone: %s", (text) => {
    expect(stripPii(text)).toBe(text);
  });
});

describe("sanitizeContext", () => {
  test("caps at the limit the protocol enforces", () => {
    expect(sanitizeContext("x".repeat(1000))).toHaveLength(MAX_CONTEXT_CHARS);
  });

  test("strips before capping, so no partial email survives the cut", () => {
    const text = `${"x".repeat(MAX_CONTEXT_CHARS - 5)} priya@acme.com`;
    const out = sanitizeContext(text);
    expect(out).not.toContain("priya");
    expect(out.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });
});
