"use server";

import { revalidatePath } from "next/cache";
import { postNowThroughCore, saveAutopostThroughCore } from "@/lib/core-views/autopost";
import { withTypedValues, type FormErrors, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action (step 54): core checks the person, the input and
// the limits.

export async function saveAutopostAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const result = await saveAutopostThroughCore(formData);
  revalidatePath("/", "layout");
  return result.ok ? { saved: true } : { errors: withTypedValues(result.errors, formData, ["frequency", "time", "mode"]) };
}

// "Post one now": written at once; in Automatic it goes out after the answer.
export async function postNowAction(): Promise<FormErrors | undefined> {
  await requireSessionContext();
  // Core sends the post itself right after its answer, so nothing runs
  // after this one; the page refreshes itself until it shows posted.
  const posted = await postNowThroughCore();
  revalidatePath("/", "layout");
  return posted.ok ? undefined : posted.errors;
}
