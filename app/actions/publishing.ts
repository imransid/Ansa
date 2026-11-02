"use server";

import { revalidatePath } from "next/cache";
import {
  actOnPublishJobThroughCore,
  createAutopublishRuleThroughCore,
  markJobPublishedThroughCore,
  planCalendarThroughCore,
  scheduleDraftThroughCore,
  switchAutopublishRuleThroughCore,
} from "@/lib/core-views/publishing-actions";
import { withTypedValues, type FormErrors, type FormResult } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { CalendarPlanResult } from "@/lib/types/calendar-planning";

// Server actions are public POST endpoints. Keep them thin: read the form,
// ask core (which checks company, role, input and rate limits), refresh the
// Co-Founder's pages. Core sends a post that is due right after its answer.

// A draft's "Schedule": the accounts ticked, now or the UTC time the
// browser made from the date and time typed (its onSubmit sets it).
export async function scheduleDraftAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = {
    draftId: formData.get("draftId"),
    version: formData.get("version"),
    connectionIds: formData.getAll("connectionId"),
    when: formData.get("when"),
    scheduledFor: formData.get("scheduledFor"),
    withoutApproval: formData.get("withoutApproval"),
  };
  return refreshOrReturnErrors(await scheduleDraftThroughCore(input));
}

export async function cancelPublishJobAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await actOnPublishJobThroughCore(formData.get("jobId"), "cancel"));
}

export async function publishJobNowAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await actOnPublishJobThroughCore(formData.get("jobId"), "publish-now"));
}

export async function retryPublishJobAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await actOnPublishJobThroughCore(formData.get("jobId"), "retry"));
}

export async function markJobPublishedAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await markJobPublishedThroughCore(formData.get("jobId"), formData.get("postUrl"));
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["postUrl"]);
  }
  refreshCoFounderPages();
  return undefined;
}

export async function markJobNotPublishedAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await actOnPublishJobThroughCore(formData.get("jobId"), "mark-not-published"));
}

export async function createAutopublishRuleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await createAutopublishRuleThroughCore(formData.get("platform"), formData.get("pillar"));
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["platform", "pillar"]);
  }
  refreshCoFounderPages();
  return undefined;
}

export async function enableAutopublishRuleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await switchAutopublishRuleThroughCore(formData.get("ruleId"), true));
}

export async function disableAutopublishRuleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await switchAutopublishRuleThroughCore(formData.get("ruleId"), false));
}

// "Plan the next 2 weeks": the browser's own timezone (its onSubmit sets it).
export async function planCalendarAction(_previous: CalendarPlanResult | undefined, formData: FormData): Promise<CalendarPlanResult> {
  await requireSessionContext();
  const result = await planCalendarThroughCore(formData.get("timeZone"));
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
