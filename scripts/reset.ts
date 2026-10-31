// The console's Reset button, from a terminal: resets both experts, the feed, the open cards and
// both chat pages. Run: bun scripts/reset.ts. Needs the console on 3000.
export {}; // top-level await needs a module

const RESET_URL = "http://127.0.0.1:3000/reset";

const response = await fetch(RESET_URL, { method: "POST" }).catch(() => null);
if (!response?.ok) {
  console.error(
    response
      ? `Reset failed: the console returned ${response.status}. See console.log.`
      : "Reset failed: nothing is answering on port 3000. Start the console first.",
  );
  process.exit(1);
}

const { missed } = (await response.json()) as { missed: string[] };
if (missed.length > 0) {
  console.error(`Experts and feed reset, but these chats did not clear: ${missed.join(", ")}`);
  process.exit(1);
}
console.log("Reset: both experts, the feed, the cards and both chats.");
