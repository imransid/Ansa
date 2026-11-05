// The shapes core's device API answers with (the phone app's contract with
// core: POST /device/v1/pair, /heartbeat, /away, /unpair and GET /home).

// What ansa is doing right now for this account.
export type Status = {
  // The business's name, or the person's.
  accountName: string;
  kind: "business" | "personal";
  // "paused": ansa answers nobody.
  state: "available" | "away" | "paused";
  // Why ansa is away: the person said so, no phone could be reached, or it is
  // one of the person's away times. Empty when not away.
  awayBy: "" | "you" | "phone" | "hours";
  // When the away began (RFC 3339), or "".
  since: string;
  // A business that answers always: ansa answers every customer anyway.
  answersAlways: boolean;
  // "Answer for me when my phone is unreachable" is on (set on the website).
  followPhone: boolean;
  // How long no phone may check in before ansa answers for the person.
  waitMinutes: number;
};

// One line of "What ansa did".
export type ActivityLine = {
  // When it happened (RFC 3339).
  at: string;
  // What ansa did, worded for people ("Answered a message").
  text: string;
  // Who it was for; may be empty.
  who: string;
};

export type PairAnswer = {
  token: string;
  deviceId: string;
  status: Status;
};

export type StatusAnswer = {
  status: Status;
};

export type HomeAnswer = {
  status: Status;
  // How many things wait for a person.
  needsYou: number;
  // ansa's newest lines, newest first.
  activity: ActivityLine[];
};

export type Platform = "ios" | "android";
