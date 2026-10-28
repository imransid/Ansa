import "server-only";
import { z } from "zod";
import { userRoles, type UserRole } from "@/db/schema";
import { auth } from "@/lib/auth";

// Who is making a request. This is the ONLY trusted source of companyId.
// Pages, actions and routes get it through lib/session.ts.
export type SessionContext = {
  userId: string;
  companyId: string;
  role: UserRole;
  name: string;
  email: string;
};

const sessionUserSchema = z.object({
  id: z.string(),
  companyId: z.uuid(),
  role: z.enum(userRoles),
  name: z.string(),
  email: z.string(),
  // Must be there and empty. Removing a teammate deletes their sessions
  // (db/team-members.ts); this refuses any that survived, so a removed person
  // is logged out on their very next click, whatever happened to their sessions.
  deactivatedAt: z.null(),
});

// Reads who is logged in from a request's headers (its session cookie), or
// null if nobody is. Kept apart from lib/session.ts, which needs Next.js's
// request helpers, so the checks can call it outside a request.
export async function getSessionContextFromHeaders(requestHeaders: Headers): Promise<SessionContext | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return null;
  }

  // Every user row has a company and a role (both columns are NOT NULL).
  // If either is somehow missing or malformed, or the user was removed from
  // the team, treat them as logged out rather than guess.
  const parsed = sessionUserSchema.safeParse(session.user);
  if (!parsed.success) {
    return null;
  }

  return {
    userId: parsed.data.id,
    companyId: parsed.data.companyId,
    role: parsed.data.role,
    name: parsed.data.name,
    email: parsed.data.email,
  };
}
