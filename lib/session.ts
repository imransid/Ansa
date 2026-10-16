import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { userRoles, type UserRole } from "@/db/schema";
import { auth } from "@/lib/auth";

// Who is making this request. This is the ONLY trusted source of companyId.
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
});

// Returns the logged-in user and their company, or null if nobody is logged in.
export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }

  // Every user row has a company and a role (both columns are NOT NULL).
  // If either is somehow missing or malformed, treat the user as logged out
  // rather than guess which company they belong to.
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

// Same as getSessionContext, but sends logged-out visitors to /login.
export async function requireSessionContext(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) {
    redirect("/login");
  }
  return session;
}
