"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { connectStandInThroughCore, disconnectAccountThroughCore, startSocialConnectThroughCore } from "@/lib/core-views/accounts";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Server actions are public POST endpoints. Keep them thin: read the form, ask
// core (which checks the role, the input and the rate limit), then send the
// owner on to the platform or back to the page they acted on (the Accounts
// page, or Settings → Connections). Core asks the platform to take a
// disconnected account's access back, after its answer.

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
  return backToPageOrErrors(await connectStandInThroughCore(formData.get("platform")), returnPageOf(formData));
}

export async function disconnectSocialAccountAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return backToPageOrErrors(await disconnectAccountThroughCore(formData.get("connectionId")), returnPageOf(formData));
}

// Where the owner acted: Settings → Connections when its form says so (a
// hidden "from"), else the Accounts page. Never an address from the form.
function returnPageOf(formData: FormData): string {
  return formData.get("from") === "connections" ? "/settings/channels" : "/cofounder/accounts";
}

function backToPageOrErrors(result: FormResult, page: string): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/cofounder", "layout");
  revalidatePath("/settings/channels");
  // A Facebook Page also carries messages: its conversations' replies change.
  revalidatePath("/inbox", "layout");
  // WHY a redirect, not only the refresh: the address may still hold the
  // last return from a platform (?result=connected), whose message would
  // stay above what this changed. "replace": Back doesn't bring it back.
  // redirect() works by throwing, so it must never sit inside a try/catch.
  redirect(page, RedirectType.replace);
}
