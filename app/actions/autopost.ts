"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withTypedValues, type FormErrors, type SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { postNowForSession, saveAutopostForSession } from "@/services/autopost";
import { runPublishJobsNow } from "@/services/publish-runs";

// Thin, like every action (step 54): the services check the person, the
// input and the limits.

export async function saveAutopostAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const fields = ["enabled", "frequency", "time", "mode", "understood"];
  const result = await saveAutopostForSession(session, Object.fromEntries(fields.map((name) => [name, formData.get(name)])));
  revalidatePath("/", "layout");
  return result.ok ? { saved: true } : { errors: withTypedValues(result.errors, formData, ["frequency", "time", "mode"]) };
}

// "Post one now": written at once; in Automatic it goes out after the answer.
export async function postNowAction(): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await postNowForSession(session);
  if (result.ok && result.jobIds && result.jobIds.length > 0) {
    const jobIds = result.jobIds;
    after(async () => {
      await runPublishJobsNow(session.companyId, jobIds);
    });
  }
  revalidatePath("/", "layout");
  return result.ok ? undefined : result.errors;
}
