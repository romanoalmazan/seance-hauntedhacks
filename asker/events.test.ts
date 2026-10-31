import { describe, expect, test } from "bun:test";
import type { Answer } from "../shared/protocol";
import type { AskRecord } from "./asker-agent";
import { eventStream } from "./events";

function record(requestId: string, text: string | null): AskRecord {
  const answer = text === null ? null : ({ text } as Answer);
  return { requestId, team: "battery", question: "q", answer, error: null };
}

function fakeAsker(records: AskRecord[] = []) {
  const listeners = new Set<(r: AskRecord) => void>();
  return {
    store: new Map(records.map((r) => [r.requestId, r])),
    onUpdate(listener: (r: AskRecord) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listeners,
    publish: (r: AskRecord) => listeners.forEach((listener) => listener(r)),
  };
}

const decoder = new TextDecoder();

async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return decoder.decode(value);
}

async function open(asker: ReturnType<typeof fakeAsker>, heartbeatMs?: number) {
  const reader = eventStream(asker, heartbeatMs).body!.getReader();
  expect(await nextChunk(reader)).toBe(": connected\n\n");
  return reader;
}

const parsed = (chunk: string) => JSON.parse(chunk.replace(/^data: /, ""));

describe("eventStream", () => {
  test("is an event stream the browser won't cache", () => {
    const { headers } = eventStream(fakeAsker());
    expect(headers.get("content-type")).toBe("text/event-stream");
    expect(headers.get("cache-control")).toBe("no-cache");
  });

  test("replays answered records on connect, so a reconnect can't miss one", async () => {
    const asker = fakeAsker([record("a", "stored"), record("b", null)]);
    const reader = await open(asker);

    const first = await nextChunk(reader);
    expect(first).toEndWith("\n\n");
    expect(parsed(first).requestId).toBe("a");

    asker.publish(record("c", "pushed"));
    expect(parsed(await nextChunk(reader)).requestId).toBe("c"); // "b" had no answer to replay
    await reader.cancel();
  });

  test("pushes each update as one SSE event, even with newlines in the text", async () => {
    const asker = fakeAsker();
    const reader = await open(asker);

    asker.publish(record("a", "two\nlines"));
    const chunk = await nextChunk(reader);

    expect(chunk.trimEnd().split("\n")).toHaveLength(1);
    expect(parsed(chunk).answer.text).toBe("two\nlines");
    await reader.cancel();
  });

  test("sends heartbeats as comments, which EventSource ignores", async () => {
    const reader = await open(fakeAsker(), 5);
    expect(await nextChunk(reader)).toBe(": ping\n\n");
    await reader.cancel();
  });

  test("unsubscribes when the page leaves", async () => {
    const asker = fakeAsker();
    const reader = await open(asker);
    expect(asker.listeners.size).toBe(1);
    await reader.cancel();
    expect(asker.listeners.size).toBe(0);
  });
});
