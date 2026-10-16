import "server-only";

// Says whether a database error is Postgres refusing a duplicate (unique
// constraint or index). Drizzle wraps the Postgres error in `cause`.
export function isUniqueViolation(error: unknown): boolean {
  return postgresCode(error) === "23505";
}

// Says whether a database error is Postgres refusing to delete a row that
// other rows still point at (a foreign key).
export function isForeignKeyViolation(error: unknown): boolean {
  return postgresCode(error) === "23503";
}

function postgresCode(error: unknown): unknown {
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
}
