import { z } from "zod";

// Better Auth hands us its user records as plain objects. A record counts as
// an active account only when deactivatedAt is there and empty: a teammate an
// owner removed has a date there (db/team-members.ts). A record without the
// field at all (say, lib/auth.ts stopped declaring it) is refused too, so that
// mistake locks everyone out at once instead of quietly letting removed
// people back in.
const activeAccountSchema = z.object({ deactivatedAt: z.null() });

// Says whether this Better Auth user record belongs to someone still on their team.
export function isActiveAccount(user: unknown): boolean {
  return activeAccountSchema.safeParse(user).success;
}
