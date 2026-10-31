// The team directory the chat page shows. The user picks from it; the agent never guesses.
import type { TeamId } from "../shared/types";

export interface TeamInfo {
  teamId: TeamId;
  displayName: string;
  ownerName: string;
  owns: string;
  address: string; // Relay agent name
}

export const DIRECTORY: TeamInfo[] = [
  {
    teamId: "software",
    displayName: "Software",
    ownerName: "Sam",
    owns: "X database ingest format, data pipelines, internal APIs",
    address: "expert-software",
  },
  {
    teamId: "battery",
    displayName: "Battery",
    ownerName: "Dana",
    owns: "pack electrical limits, thermal derating, charging, supplier",
    address: "expert-battery",
  },
  {
    teamId: "actuators",
    displayName: "Actuators",
    ownerName: "Marcus",
    owns: "ACT-7 limits, controller limit, bearings, roadmap",
    address: "expert-actuators",
  },
];

/** Exact match on the teamId, ignoring case. No aliases and no fuzzy matching: that would be guessing. */
export function findTeam(name: string): TeamInfo | undefined {
  const wanted = name.toLowerCase();
  return DIRECTORY.find((t) => t.teamId === wanted);
}

export function teamInfo(team: TeamId): TeamInfo {
  const info = findTeam(team);
  if (!info) throw new Error(`Team ${team} is not in the directory`);
  return info;
}

/** One line per team, for replies that ask the user to pick. */
export function describeDirectory(): string {
  return DIRECTORY.map((t) => `@${t.teamId} (${t.ownerName}: ${t.owns})`).join("\n");
}
