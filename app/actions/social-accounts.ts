"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { connectStandInThroughCore, disconnectAccountThroughCore, startSocialConnectThroughCore } from "@/lib/core-views/accounts";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Server actions are public POST endpoints. Keep them thin: read the form, ask
// core (which checks the role, the input and the rate limit), then send the
// owner on to the platform or back to the Accounts page. Core asks the
// platform to take a disconnected account's access back, after its answer.

export async function connectSocialAccountAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await startSocialConnectThroughCore(formData.get("platform"));
  if (!result.ok) {
    return result.errors;
  }
  // The platform's consent screen. redirect() works by throwing, so it
  // must never sit inside a try/catch.
  redirect(result.url);
}

export async function connectStandInAccountAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return backToAccountsPageOrErrors(await connectStandInThroughCore(formData.get("platform")));
}

export async function disconnectSocialAccountAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return backToAccountsPageOrErrors(await disconnectAccountThroughCore(formData.get("connectionId")));
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
