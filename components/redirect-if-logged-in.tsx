import { redirect } from "next/navigation";
import { destinationAfterLogin } from "@/lib/login-redirect";
import { getSessionContext } from "@/lib/session";

type RedirectIfLoggedInProps = {
  // The log in page's URL query, for its ?next= (the page asked for).
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// Sends someone who is already logged in on from the log in and sign up
// pages: to the page they asked for, else to their tickets. Renders nothing.
// WHY a real session check here and not in proxy.ts: a browser can keep the
// cookie of a session that ended (logged out elsewhere, removed from the
// team). Judged by the cookie alone, it would bounce between /login and the
// app forever.
export async function RedirectIfLoggedIn({ searchParams }: RedirectIfLoggedInProps) {
  const session = await getSessionContext();
  if (!session) {
    return null;
  }
  const next = searchParams ? (await searchParams).next : undefined;
  redirect(destinationAfterLogin(next));
}
