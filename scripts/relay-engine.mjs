// Starts the stock Relaycast engine bound to 127.0.0.1 only. The engine CLI has no --host flag
// (it calls @hono/node-server serve({ port }), which listens on every interface), so this patches
// net.Server#listen to default the host before loading it. Same flags as the engine:
//   node scripts/relay-engine.mjs --db ./relaycast.db --port 8787
// RELAY_HOST overrides the bind address (e.g. 0.0.0.0 to share over a LAN on purpose).
import net from "node:net";

const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === "number" && typeof args[1] !== "string") args.splice(1, 0, HOST);
  else if (args[0] && typeof args[0] === "object" && args[0].host === undefined) args[0] = { ...args[0], host: HOST };
  return listen.apply(this, args);
};

await import("../node_modules/@relaycast/engine/dist/bin/serve.js");
