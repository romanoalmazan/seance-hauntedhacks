// Sends the seeded attacks as Guest through /raw, so each reaches the expert exactly as typed.
// Run: bun scripts/redteam.ts. Needs the Guest asker on 3002 and the console on 3000.
import actuators from "../seed/actuators.json";
import attacks from "../seed/attacks.json";
import battery from "../seed/battery.json";
import type { AuditEvent, TeamId } from "../shared/types";

const GUEST_ASK_URL = "http://127.0.0.1:3002/ask";
const CONSOLE_URL = "http://127.0.0.1:3000";

const TEAM = attacks.team as TeamId;
const PROTECTED_TOKENS = [...battery.knowledge, ...actuators.knowledge].flatMap(
  (entry) => entry.protectedTokens,
);

export interface RedteamResult {
  prompt: string;
  /** No protected token came back and the attempt was logged. */
  blocked: boolean;
  leaked: string[];
  logged: boolean;
  /** The audit decision, when the attempt was logged. */
  decision?: AuditEvent["decision"];
  /** Set when the attempt couldn't be made or checked. */
  error?: string;
}

export interface RedteamReport {
  passed: number;
  total: number;
  results: RedteamResult[];
}

export interface RedteamDeps {
  /** Sends one chat line as Guest and returns the response body, unparsed. */
  ask(text: string): Promise<string>;
  audit(team: TeamId): Promise<AuditEvent[]>;
}

async function okBody(response: Response, what: string): Promise<string> {
  if (!response.ok) throw new Error(`${what} returned ${response.status}`);
  return response.text();
}

/** The Guest asker's POST /ask. */
export async function askGuest(text: string): Promise<string> {
  const response = await fetch(GUEST_ASK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => {
    throw new Error("The Guest asker isn't running on port 3002");
  });
  return okBody(response, "The Guest asker");
}

async function consoleAudit(team: TeamId): Promise<AuditEvent[]> {
  const response = await fetch(`${CONSOLE_URL}/snapshot/${team}`, { cache: "no-store" });
  return JSON.parse(await okBody(response, "The console")).audit;
}

/** The whole body is searched, not just the answer's text: a leaked hint is still a leak. */
function leakedTokens(body: string): string[] {
  const haystack = body.toLowerCase();
  return PROTECTED_TOKENS.filter((token) => haystack.includes(token.toLowerCase()));
}

async function attempt(prompt: string, deps: RedteamDeps): Promise<RedteamResult> {
  const logEntries = async () =>
    (await deps.audit(TEAM)).filter((e) => e.asker === attacks.asker && e.question === prompt);

  try {
    // Counted first, so an earlier run's entry can't vouch for this attempt.
    const before = (await logEntries()).length;
    const leaked = leakedTokens(await deps.ask(`/raw ${TEAM} ${prompt}`));
    const entries = await logEntries();
    const logged = entries.length > before;
    return {
      prompt,
      blocked: logged && leaked.length === 0,
      leaked,
      logged,
      ...(logged ? { decision: entries.at(-1)?.decision } : {}),
    };
  } catch (error) {
    return { prompt, blocked: false, leaked: [], logged: false, error: (error as Error).message };
  }
}

/** One at a time, so the audit log reads in prompt order. */
export async function redteam(
  deps: RedteamDeps = { ask: askGuest, audit: consoleAudit },
): Promise<RedteamReport> {
  const results: RedteamResult[] = [];
  for (const prompt of attacks.prompts) results.push(await attempt(prompt, deps));
  return {
    passed: results.filter((result) => result.blocked).length,
    total: results.length,
    results,
  };
}

function describe({ blocked, decision, error, leaked, logged }: RedteamResult): string {
  if (error) return error;
  if (blocked) return String(decision);
  const reasons = [
    ...(leaked.length > 0 ? [`leaked ${leaked.join(", ")}`] : []),
    ...(logged ? [] : ["not in the audit log"]),
  ];
  return reasons.join("; ");
}

if (import.meta.main) {
  const { passed, total, results } = await redteam();
  for (const result of results) {
    console.log(`${result.blocked ? "PASS" : "FAIL"}  ${result.prompt}  (${describe(result)})`);
  }
  console.log(`${passed} of ${total} blocked`);
  process.exit(passed === total ? 0 : 1);
}
