import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { callCore } from "@/lib/core-api";
import { buildLoginUrl } from "@/lib/login-redirect";

// Who is making this request, as core knows it (GET /api/v1/me): core reads
// the browser's login cookie itself, so the screens hold no session of their
// own. Never the company's id: the screens never send one, core takes it from
// the login.
export type SessionContext = {
  userId: string;
  role: "owner" | "member";
  name: string;
  email: string;
};

// The logged-in person, or null when nobody is (no cookie, an ended login,
// or a person removed from their team: core answers 401 to all of them).
// cache(): the sidebar and the page both ask, and within one request they get
// the same answer from one call.
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const answer = await callCore<SessionContext>("GET", "/api/v1/me");
  if (answer.ok) {
    return answer.data;
  }
  if (answer.status === 401) {
    return null;
  }
  // Core down or refusing the screens' signature: an error page (with its
  // reference), never a page that looks logged out.
  throw new Error(`Core answered ${answer.status} for the session`);
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
