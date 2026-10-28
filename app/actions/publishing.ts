"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withTypedValues, type FormErrors, type FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { createAutopublishRuleForSession, setAutopublishRuleForSession } from "@/services/autopublish-rules";
import { planNextTwoWeeksForSession, type CalendarPlanResult } from "@/services/calendar-planning";
import {
  cancelPublishJobForSession,
  markJobNotPublishedForSession,
  markJobPublishedForSession,
  publishJobNowForSession,
  retryPublishJobForSession,
} from "@/services/publish-job-actions";
import { scheduleDraftForSession } from "@/services/publish-scheduling";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company, role, input and rate limits),
// refresh the Co-Founder's pages. A post due now is sent after the answer,
// through Next's after(), within the page's 300 seconds (maxDuration).

const runAfterResponse = (task: () => Promise<unknown>) => after(task);

// A draft's "Schedule": the accounts ticked, now or the UTC time the
// browser made from the date and time typed (its onSubmit sets it).
export async function scheduleDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const input = {
    draftId: formData.get("draftId"),
    version: formData.get("version"),
    connectionIds: formData.getAll("connectionId"),
    when: formData.get("when"),
    scheduledFor: formData.get("scheduledFor"),
    withoutApproval: formData.get("withoutApproval"),
  };
  return refreshOrReturnErrors(await scheduleDraftForSession(session, input, runAfterResponse));
}

export async function cancelPublishJobAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await cancelPublishJobForSession(session, { jobId: formData.get("jobId") }));
}

export async function publishJobNowAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await publishJobNowForSession(session, { jobId: formData.get("jobId") }, runAfterResponse));
}

export async function retryPublishJobAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await retryPublishJobForSession(session, { jobId: formData.get("jobId") }, runAfterResponse));
}

export async function markJobPublishedAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await markJobPublishedForSession(session, { jobId: formData.get("jobId"), postUrl: formData.get("postUrl") });
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["postUrl"]);
  }
  refreshCoFounderPages();
  return undefined;
}

export async function markJobNotPublishedAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await markJobNotPublishedForSession(session, { jobId: formData.get("jobId") }));
}

export async function createAutopublishRuleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await createAutopublishRuleForSession(session, { platform: formData.get("platform"), pillar: formData.get("pillar") });
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["platform", "pillar"]);
  }
  refreshCoFounderPages();
  return undefined;
}

export async function enableAutopublishRuleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await setAutopublishRuleForSession(session, { ruleId: formData.get("ruleId") }, true));
}

export async function disableAutopublishRuleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await setAutopublishRuleForSession(session, { ruleId: formData.get("ruleId") }, false));
}

// "Plan the next 2 weeks": the browser's own timezone (its onSubmit sets it).
export async function planCalendarAction(_previous: CalendarPlanResult | undefined, formData: FormData): Promise<CalendarPlanResult> {
  const session = await requireSessionContext();
  const result = await planNextTwoWeeksForSession(session, { timeZone: formData.get("timeZone") });
  if (result.ok) {
    refreshCoFounderPages();
  }
  return result;
}

function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  refreshCoFounderPages();
  return undefined;
}

// Every page under /cofounder: the queue, the calendar and each draft's page.
function refreshCoFounderPages(): void {
  revalidatePath("/cofounder", "layout");
}
