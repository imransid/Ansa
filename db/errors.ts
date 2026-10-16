import "server-only";

// Says whether a database error is Postgres refusing a duplicate (unique
// constraint or index). Drizzle wraps the Postgres error in `cause`.
export function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505";
}
