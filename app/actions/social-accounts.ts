"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { after } from "next/server";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { connectStandInAccountForSession, startSocialConnectionForSession } from "@/services/social-connect";
import { disconnectSocialAccountForSession } from "@/services/social-disconnect";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks the role, the input and the rate limit),
// then send the owner on to the platform or back to the Accounts page. The
// platform is asked to take a disconnected account's access back after the
// answer, through Next's after() (which runs after a redirect too).

export async function connectSocialAccountAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await startSocialConnectionForSession(session, { platform: formData.get("platform") });
  if (!result.ok) {
    return result.errors;
  }
  // The platform's consent screen. redirect() works by throwing, so it
  // must never sit inside a try/catch.
  redirect(result.url);
}

export async function connectStandInAccountAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return backToAccountsPageOrErrors(await connectStandInAccountForSession(session, { platform: formData.get("platform") }));
}

export async function disconnectSocialAccountAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await disconnectSocialAccountForSession(session, { connectionId: formData.get("connectionId") }, (task) => after(task));
  return backToAccountsPageOrErrors(result);
}

function backToAccountsPageOrErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/cofounder", "layout");
  // WHY a redirect, not only the refresh: the address may still hold the
  // last return from a platform (?result=connected), whose message would
  // stay above what this changed. "replace": Back doesn't bring it back.
  // redirect() works by throwing, so it must never sit inside a try/catch.
  redirect("/cofounder/accounts", RedirectType.replace);
}
