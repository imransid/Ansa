import type { InboxRow } from "@/lib/types/conversations";

// Home's two lists that point somewhere (the "easy to use" pass of
// 2026-11-01): what an owner still has to do before ansa can answer, and the
// conversations that wait for a person, each one by name.

export type GettingStartedStep = {
  key: "channel" | "engine" | "menu" | "instructions";
  done: boolean;
  // What to do, as a link's words.
  label: string;
  href: string;
  // What was found, once it's done.
  doneText: string;
};

// The newest conversations that need a person, how many there are, and
// whether requests can be shared out (more than one person takes them:
// otherwise "nobody on it" only repeats the conversations listed, and every
// open request waits for the one person, so Home never names a team).
export type NeedsYou = {
  // The newest 5; the rest are one click away.
  rows: InboxRow[];
  total: number;
  hasTeam: boolean;
};
