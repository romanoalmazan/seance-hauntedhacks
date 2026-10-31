// The team directory the chat page shows. The user picks from it; the agent never guesses.
import type { TeamId } from "../shared/types";

export interface TeamInfo {
  teamId: TeamId;
  displayName: string;
  ownerName: string;
  owns: string;
  address: string; // Relay agent name
  hidden?: boolean; // reachable with /raw (red team) but not listed
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
    teamId: "controls",
    displayName: "Controls",
    ownerName: "Priya",
    owns: "controller tuning, current limits, safety interlocks",
    address: "expert-controls",
  },
  {
    teamId: "robotics",
    displayName: "Robotics",
    ownerName: "Alex",
    owns: "robot cells, motion planning, test rigs",
    address: "expert-robotics",
  },
  // Not listed: kept for the red team (/raw battery ...) and the older beats.
  { teamId: "battery", displayName: "Battery", ownerName: "Dana", owns: "pack limits, charging, supplier", address: "expert-battery", hidden: true },
  { teamId: "actuators", displayName: "Actuators", ownerName: "Marcus", owns: "ACT-7 limits, bearings, roadmap", address: "expert-actuators", hidden: true },
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
  return DIRECTORY.filter((t) => !t.hidden).map((t) => `@${t.teamId} (${t.ownerName}: ${t.owns})`).join("\n");
}
