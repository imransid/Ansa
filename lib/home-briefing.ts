// The sentence on Home's status card (step 44; counting people since the
// "easy to use" pass of 2026-11-01): what waits for the owner, said in plain
// words. Pure, so a check can read every case.

const SPELLED = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

type BriefingInput = {
  // Conversations that need a person (Home's "Needs you" list).
  peopleWaiting: number;
  // How many other rows "Needs you" shows (kinds of things, not items): a
  // request nobody has (without a team: the requests no conversation
  // lists), stuck emails, posts to check, failed posts, accounts to reconnect.
  otherThingsWaiting: number;
  // Open tickets of the company, assigned or not.
  openTickets: number;
  // More than one person in a business takes requests: a person, or a
  // business of one, has no team to hand them to.
  hasTeam: boolean;
};

export function briefingSentence({ peopleWaiting, otherThingsWaiting, openTickets, hasTeam }: BriefingInput): string {
  const people = peopleWaiting === 1 ? "One person" : `${spelled(peopleWaiting)} people`;
  const things = otherThingsWaiting === 1 ? "one thing" : `${spelled(otherThingsWaiting).toLowerCase()} things`;
  if (peopleWaiting > 0 && otherThingsWaiting > 0) {
    const more = otherThingsWaiting === 1 ? "one more thing" : `${spelled(otherThingsWaiting).toLowerCase()} more things`;
    return `${people} and ${more} are waiting for you below.`;
  }
  if (peopleWaiting > 0) {
    return `${people} ${peopleWaiting === 1 ? "is" : "are"} waiting for you below.`;
  }
  if (otherThingsWaiting > 0) {
    return `${things.charAt(0).toUpperCase()}${things.slice(1)} ${otherThingsWaiting === 1 ? "is" : "are"} waiting for you below.`;
  }
  // Nothing waiting means no open ticket lacks someone, so any open ones are
  // with a teammate. A person or a business of one has no teammate: their
  // open requests wait for them and were counted above.
  if (openTickets > 0 && hasTeam) {
    return "Nothing is waiting for you. Your team has the open requests in hand.";
  }
  if (openTickets > 0) {
    return "Nothing is waiting for you.";
  }
  return "All quiet. Nothing is waiting for you.";
}

function spelled(count: number): string {
  return SPELLED[count] ?? String(count);
}
