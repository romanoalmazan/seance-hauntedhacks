// bun scripts/owner-reply.ts <team> <escalationId> "<text>" [--save --tier public --tags a,b] [--owner Marcus]
// Sends an owner_reply as `console`.
import { connect } from "../shared/relay";
import { PROTOCOL_VERSION } from "../shared/protocol";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const save = args.includes("--save");
if (save) args.splice(args.indexOf("--save"), 1);
const tier = (flag("--tier") ?? "public") as "public" | "internal" | "restricted";
const tags = (flag("--tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
const [team, escalationId, ...words] = args;
const ownerName = flag("--owner") ?? (team === "battery" ? "Dana" : "Marcus");
const text = words.join(" ");
if ((team !== "battery" && team !== "actuators") || !escalationId || !text) {
  console.error('usage: bun scripts/owner-reply.ts <team> <escalationId> "<text>" [--save --tier public --tags a,b]');
  process.exit(1);
}

const relay = await connect("console");
await relay.send(`expert-${team}`, {
  v: PROTOCOL_VERSION, kind: "owner_reply", requestId: crypto.randomUUID(), at: new Date().toISOString(),
  escalationId, ownerName, text, save, sensitivity: tier, tags,
});
console.log(`owner_reply sent to expert-${team} for ${escalationId}${save ? ` (save as ${tier}, tags ${tags.join(",")})` : ""}`);
await relay.close();
process.exit(0);
