import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildLoginUrl } from "@/lib/login-redirect";
import { getSessionContextFromHeaders, type SessionContext } from "@/lib/session-context";

// Who is making this request. This is the ONLY trusted source of companyId.
export type { SessionContext };

// Returns the logged-in user and their company, or null if nobody is logged in
// (or they were removed from their team, see lib/session-context.ts).
// cache(): the page header and the page itself both ask, and within one
// request they get the same answer from one database read.
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  return getSessionContextFromHeaders(await headers());
});

// Same as getSessionContext, but sends logged-out visitors to /login.
// returnPath: the page they wanted (pages pass their own path), so logging in
// brings them back there, e.g. to the ticket an assignment email linked to.
export async function requireSessionContext(returnPath?: string): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) {
    redirect(returnPath ? buildLoginUrl(returnPath) : "/login");
  }
  return session;
}
