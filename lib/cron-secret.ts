import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// Says whether an Authorization header is "Bearer <the secret>": the check
// both scheduled routes make (/api/cron/cleanup, /api/cron/publish).
export function isCorrectCronSecret(authorization: string | null, secret: string): boolean {
  // Hashing first gives equal lengths, which timingSafeEqual needs, and the
  // comparison takes the same time whatever was sent.
  const sent = createHash("sha256").update(authorization ?? "").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(sent, expected);
}
