// The words of Home's status card, from the Status core sends: one big word,
// one short sentence, the details, and the one button that makes sense from
// here. Pure, so every case is easy to read and check. The wording follows
// the website's Home (app/dashboard/status-card.tsx).
import type { Status } from "../api/types";
import { describeSince } from "./local-time";

export type MainButton = {
  label: "I'm away" | "I'm back";
  // What the button sends to POST /device/v1/away.
  away: boolean;
  // What a screen reader says: the label and what it does.
  accessibleLabel: string;
};

export type StatusWords = {
  word: "Available" | "Away" | "Paused";
  sentence: string;
  details: string[];
  button: MainButton | null;
};

const AWAY_BUTTON: MainButton = { label: "I'm away", away: true, accessibleLabel: "I'm away: ansa answers for me now" };
const BACK_BUTTON: MainButton = { label: "I'm back", away: false, accessibleLabel: "I'm back: I answer my messages again" };

export function describeStatus(status: Status, now: Date = new Date()): StatusWords {
  if (status.state === "paused") return describePaused();
  if (status.state === "away") return describeAway(status, now);
  return describeAvailable(status);
}

function describePaused(): StatusWords {
  return {
    word: "Paused",
    sentence: "ansa answers nobody right now.",
    details: ["Turn it back on from ansa's website."],
    // "I'm away" changes nothing while ansa answers nobody.
    button: null,
  };
}

function describeAway(status: Status, now: Date): StatusWords {
  const since = describeSince(status.since, now);
  const details: string[] = [];
  if (status.awayBy === "phone") {
    details.push(joinSince(since, "because your phone was unreachable."));
    details.push("ansa switches back when this phone checks in.");
  } else if (status.awayBy === "you") {
    details.push(joinSince(since, "when you said you were away."));
  } else if (status.awayBy === "hours") {
    details.push("It's one of your away times. It ends by itself.");
  } else if (since !== "") {
    details.push(`${since}.`);
  }
  if (status.answersAlways) details.push(answersAlwaysLine(status));
  // Away times end by themselves: the website offers no "I'm back" for them either.
  const button = status.awayBy === "hours" ? null : BACK_BUTTON;
  return { word: "Away", sentence: "ansa answers for you.", details, button };
}

function describeAvailable(status: Status): StatusWords {
  if (status.answersAlways) {
    return {
      word: "Available",
      sentence: "ansa answers everyone anyway.",
      details: ["Anything it isn't sure of comes to you."],
      button: AWAY_BUTTON,
    };
  }
  const details = status.followPhone
    ? [`If this phone can't reach ansa for ${minutes(status.waitMinutes)}, ansa answers for you.`]
    : ["Press “I'm away” when you can't answer, and ansa takes over."];
  return { word: "Available", sentence: "You answer your messages.", details, button: AWAY_BUTTON };
}

// "Since 21:40, because ..." or, without a time, "Because ...".
function joinSince(since: string, reason: string): string {
  if (since === "") return reason.charAt(0).toUpperCase() + reason.slice(1);
  return `${since}, ${reason}`;
}

function answersAlwaysLine(status: Status): string {
  return status.kind === "business" ? "It answers every customer anyway, away or not." : "It answers every message anyway, away or not.";
}

function minutes(count: number): string {
  return count === 1 ? "1 minute" : `${count} minutes`;
}
