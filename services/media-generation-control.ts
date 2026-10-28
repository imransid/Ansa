import "server-only";
import { cancelGenerationJob, isGenerationJobStuck } from "@/db/media-generation-jobs";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { generationJobIdSchema } from "@/lib/validation/media";
import type { RunAfterResponse } from "./media-generation-jobs";
import { claimGenerationRun, runClaimedGenerationJob, type GenerationRunOptions } from "./media-generation-runs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// A request already made (step 39), from the media page's list of requests
// or a draft's page: Cancel while it waits, and "Start now" when its run
// never started or was cut off. Anyone in the company.

// Cancels one of the session company's requests, only while it waits to start.
export async function cancelGenerationForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = generationJobIdSchema.safeParse(input);
  if (!parsed.success) {
    return refused("Unknown request. Reload the page.");
  }
  if (await isOverRateLimit("media-changes", session.userId, RATE_LIMITS.mediaChangesPerUser)) {
    return refused("Too many changes. Try again in a few minutes.");
  }
  switch (await cancelGenerationJob(session.companyId, session.userId, parsed.data.jobId)) {
    case "canceled":
      return { ok: true };
    case "wrong-status":
      return refused("It can't be canceled any more: it is being made or already finished. Reload the page to see it.");
    case "not-found":
      return refused("We couldn't find that request. Reload the page.");
    case "not-allowed":
      return refused("You can't change media of this company.");
  }
}

// "Start now" on a stuck request (its run never started, or was cut off):
// claims it at once and has the service asked right after the answer. WHY
// the claim comes first: the page the action sends back is rendered before
// work handed to after() starts, and must show the request being made (so
// it refreshes itself, and a draft's editor waits), not stuck again. The
// claim still decides, so a run that started meanwhile is never doubled.
export async function startStuckGenerationForSession(
  session: SessionContext,
  input: unknown,
  runAfterResponse: RunAfterResponse,
  options: GenerationRunOptions = {},
): Promise<FormResult> {
  const parsed = generationJobIdSchema.safeParse(input);
  if (!parsed.success) {
    return refused("Unknown request. Reload the page.");
  }
  if (await isOverRateLimit("media-changes", session.userId, RATE_LIMITS.mediaChangesPerUser)) {
    return refused("Too many changes. Try again in a few minutes.");
  }
  const { jobId } = parsed.data;
  const isStuck = await isGenerationJobStuck(session.companyId, jobId);
  if (isStuck === undefined) {
    return refused("We couldn't find that request. Reload the page.");
  }
  const claim = isStuck ? await claimGenerationRun(session.companyId, jobId) : { outcome: "not-claimed" as const };
  switch (claim.outcome) {
    case "claimed":
      runAfterResponse(() => runClaimedGenerationJob(session.companyId, jobId, claim.claimed, options));
      return { ok: true };
    case "given-up":
      // Ended "interrupted": the refreshed page says so in plain words.
      return { ok: true };
    case "not-claimed":
      return refused("It isn't stuck: it is being made, or it finished meanwhile. Reload the page to see it.");
  }
}

// A refusal with this message.
function refused(message: string): FormResult & { ok: false } {
  return { ok: false, errors: { message } };
}
