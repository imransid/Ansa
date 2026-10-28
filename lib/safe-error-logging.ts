// Rule 1: logs must never contain phone numbers, emails, transcripts or URLs.
// Error MESSAGES can (a database error includes the query's values), so in
// logs an error is reduced to its class name, Postgres code and constraint,
// Next.js digest and stack frames. The message is never printed.

type LogTarget = Pick<Console, "error" | "warn">;

const MAX_CAUSES = 3;
const MAX_FRAMES = 8;

// A one-line, data-free description of an error and its causes.
export function describeErrorSafely(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSES && current instanceof Error; depth++) {
    parts.push(describeOne(current));
    current = current.cause;
  }
  return parts.length > 0 ? parts.join(" <- ") : "non-Error value thrown";
}

// The stack frames ("at file:line") without the first line, which repeats the message.
export function safeStackFrames(error: unknown): string[] {
  if (!(error instanceof Error) || !error.stack) {
    return [];
  }
  return error.stack
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .slice(0, MAX_FRAMES)
    .map((line) => line.trim());
}

// describeErrorSafely, then the stack frames, one per line below it: the same
// text the server prints for an Error passed to console.error. For code that
// catches a failure and logs it itself. Code that handles call or email
// content logs the class name only instead (Rule 1).
export function describeErrorWithFrames(error: unknown): string {
  return [describeErrorSafely(error), ...safeStackFrames(error).map((frame) => `    ${frame}`)].join("\n");
}

// Makes console.error and console.warn print errors the safe way. Installed
// once at server start (instrumentation.ts), so it also covers errors that
// Next.js and libraries log by themselves.
export function installSafeErrorLogging(target: LogTarget = console): void {
  for (const method of ["error", "warn"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(...args.map(safeLogArgument));
  }
}

function safeLogArgument(argument: unknown): unknown {
  if (!(argument instanceof Error)) {
    return argument;
  }
  return describeErrorWithFrames(argument);
}

function describeOne(error: Error): string {
  const details = [
    readString(error, "code") && `code ${readString(error, "code")}`,
    readString(error, "constraint") && `constraint ${readString(error, "constraint")}`,
    readString(error, "digest") && `digest ${readString(error, "digest")}`,
  ].filter(Boolean);
  return details.length > 0 ? `${error.constructor.name} (${details.join(", ")})` : error.constructor.name;
}

// Postgres codes, constraint names and digests are short, fixed identifiers.
// Anything longer or unusual is skipped rather than risk printing data.
function readString(error: Error, key: string): string | null {
  const value = (error as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
}
