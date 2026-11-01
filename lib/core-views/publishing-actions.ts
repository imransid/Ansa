import "server-only";
import { z } from "zod";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormResult } from "@/lib/form-result";
import type { CalendarPlanResult } from "@/services/calendar-planning";

// The publishing forms through the new backend (core's
// /api/v1/cofounder/publishing, /queue and /calendar): a draft's
// "Schedule", an owner's buttons on one post (the queue, a draft's page),
// the auto-publish rules and "Plan the next 2 weeks", answering as the
// services did. Core checks the person, the input and the limits, and
// sends a post that became due right after its answer: nothing waits here.

// An id from a form is only a claim: a uuid, else core is never asked
// (and it never becomes a path of its own).
const idSchema = z.uuid().transform((id) => id.toLowerCase());

const UNKNOWN_POST: FormResult = { ok: false, errors: { message: "Unknown post. Reload the page and try again." } };

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The version the page showed, as a whole number (0 = none, which core refuses).
function wholeNumber(value: unknown): number {
  const number = Number(text(value));
  return Number.isSafeInteger(number) ? number : 0;
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// What the schedule form sends (app/cofounder/studio/[draftId]/schedule-form.tsx).
export type ScheduleFormInput = {
  draftId: unknown;
  version: unknown;
  connectionIds: unknown[];
  when: unknown;
  scheduledFor: unknown;
  withoutApproval: unknown;
};

// A draft's "Schedule": the version the page showed, the accounts ticked,
// and "now" or the UTC instant the browser made from the date and time typed.
export async function scheduleDraftThroughCore(input: ScheduleFormInput): Promise<FormResult> {
  const draftId = idSchema.safeParse(input.draftId);
  if (!draftId.success) {
    return { ok: false, errors: { message: "Something went wrong. Reload the page and try again." } };
  }
  const scheduledFor = text(input.scheduledFor);
  const answer = await callCore("POST", `/api/v1/cofounder/publishing/drafts/${draftId.data}/schedule`, {
    version: wholeNumber(input.version),
    connectionIds: input.connectionIds.map(text),
    when: text(input.when),
    scheduledFor: scheduledFor === "" ? null : scheduledFor,
    // A ticked checkbox sends "on".
    withoutApproval: input.withoutApproval === "on",
  });
  return savedOrErrors(answer);
}

// Cancel, Publish now, Retry and "Mark as not published" on one post.
export async function actOnPublishJobThroughCore(jobId: unknown, action: "cancel" | "publish-now" | "retry" | "mark-not-published"): Promise<FormResult> {
  const id = idSchema.safeParse(jobId);
  if (!id.success) {
    return UNKNOWN_POST;
  }
  return savedOrErrors(await callCore("POST", `/api/v1/cofounder/queue/jobs/${id.data}/${action}`));
}

// "Mark as published", with the post's address if the owner has it ("" = none).
export async function markJobPublishedThroughCore(jobId: unknown, postUrl: unknown): Promise<FormResult> {
  const id = idSchema.safeParse(jobId);
  if (!id.success) {
    return UNKNOWN_POST;
  }
  const answer = await callCore("POST", `/api/v1/cofounder/queue/jobs/${id.data}/mark-published`, { url: text(postUrl) });
  if (answer.ok) {
    return { ok: true };
  }
  // Core names the field "url"; the form's is "postUrl".
  const problem = answer.fields.url;
  return { ok: false, errors: problem ? { fieldErrors: { postUrl: [problem] } } : { message: answer.message } };
}

// A new auto-publish rule (made switched off): a platform, and a content
// pillar of the current plan by name ("" = every pillar).
export async function createAutopublishRuleThroughCore(platform: unknown, pillar: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/cofounder/queue/rules", { platform: text(platform), pillar: text(pillar) }));
}

// Switches one rule on (the page asked the owner first) or off.
export async function switchAutopublishRuleThroughCore(ruleId: unknown, enabled: boolean): Promise<FormResult> {
  const id = idSchema.safeParse(ruleId);
  if (!id.success) {
    return { ok: false, errors: { message: "Unknown rule. Reload the page and try again." } };
  }
  return savedOrErrors(await callCore("POST", `/api/v1/cofounder/queue/rules/${id.data}`, { enabled }));
}

// "Plan the next 2 weeks" in the browser's own timezone: how many ideas
// were added. Waits for the AI (core gives it up to 4 minutes).
export async function planCalendarThroughCore(timeZone: unknown): Promise<CalendarPlanResult> {
  const answer = await callCore<{ added: number }>("POST", "/api/v1/cofounder/calendar/plan", { timeZone: text(timeZone) });
  return answer.ok ? { ok: true, added: answer.data.added } : { ok: false, errors: toFormErrors(answer) };
}
