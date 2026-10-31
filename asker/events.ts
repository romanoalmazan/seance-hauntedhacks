// GET /events: pushes every stored answer to the page as server-sent events.
import type { Asker, AskRecord } from "./asker-agent";

const HEARTBEAT_MS = 20_000; // must stay under the server's idleTimeout, or a quiet page loses its stream

const encoder = new TextEncoder();

/**
 * Replays the whole store on connect, so an EventSource that reconnects can't miss an owner's
 * answer that landed while it was away. The page treats a repeated record as a no-op. A named
 * `reset` event tells the page to clear itself.
 */
export function eventStream(
  asker: Pick<Asker, "store" | "onUpdate" | "onReset">,
  heartbeatMs = HEARTBEAT_MS,
): Response {
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop(); // the page went away before cancel() ran
        }
      };
      const push = (record: AskRecord) => write(`data: ${JSON.stringify(record)}\n\n`);

      write(": connected\n\n"); // Bun holds the headers until the first chunk, so open the stream now
      for (const record of asker.store.values()) if (record.answer) push(record);
      const unsubscribe = asker.onUpdate(push);
      // EventSource skips an event with no data, so this needs a data line too.
      const unsubscribeReset = asker.onReset(() => write("event: reset\ndata: {}\n\n"));
      const heartbeat = setInterval(() => write(": ping\n\n"), heartbeatMs);
      stop = () => {
        unsubscribe();
        unsubscribeReset();
        clearInterval(heartbeat);
      };
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
