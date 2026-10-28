import "server-only";
import { randomUUID } from "node:crypto";
import {
  claimGenerationJob,
  failGenerationJob,
  giveUpInterruptedJob,
  saveGeneratedAsset,
  saveProviderJobId,
  type ClaimedGenerationJob,
} from "@/db/media-generation-runs";
import type { Fetcher } from "@/lib/allowed-host-download";
import { putPrivateFile } from "@/lib/file-storage";
import { readImageSize } from "@/lib/media/dimensions";
import type { GenerationErrorCode } from "@/lib/media/error-codes";
import { KIND_OF_CONTENT_TYPE } from "@/lib/media/kinds";
import { currentMediaGenerationMode, providerForJob, type MediaGenerationMode, type MediaProvider } from "@/lib/media-generation";
import { fetchAndCheckOutput, MEDIA_DOWNLOAD_TIMEOUT_MS, type CheckedFile } from "./media-generation-output";
import { askProvider } from "./media-provider-calls";
import { mediaStorageKey, removeMediaFile } from "./media-files";

// Running one image or video request (step 39): right after the page's
// answer (Next's after()), and again from the scheduled job for one whose
// run never started or was cut off (services/stuck-work.ts). Each run
// claims the job first (db/media-generation-runs.ts), so two runs never
// both work it. The result is copied into our own storage at once, kept
// only if its own bytes are an accepted file of the kind asked for
// (services/media-generation-output.ts), and saved with its asset in one
// transaction. A failure saves a code and never an asset.
//
// LOGGING RULE for this file: never log the prompt, an address the service
// gave, a file key or an error message. Codes and class names only.

// How long a run may wait for the service (its start, then its polls). A
// service still working when the time is up is polled again by a later run
// (the job keeps the service's job id).
export const GENERATION_RUN_BUDGET_MS = 120_000;
// Room for storing the file and the database work (a query may wait 10 s
// for a connection, db/client.ts).
const STORAGE_ALLOWANCE_MS = 10_000;
const DATABASE_ALLOWANCE_MS = 10_000;

// The longest one run can take when everything is slow: the scheduled job
// starts one only while this still fits (services/stuck-work.ts).
export const LONGEST_GENERATION_MS = GENERATION_RUN_BUDGET_MS + MEDIA_DOWNLOAD_TIMEOUT_MS + STORAGE_ALLOWANCE_MS + DATABASE_ALLOWANCE_MS;

// Only the checks replace these: a fake service, its fake download, and a
// shorter wait between polls.
export type GenerationRunOptions = {
  mode?: MediaGenerationMode;
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
};

// "unfinished": the service is still working (or the database failed); a
// later run takes it up. "not-claimed": another run has it, or it ended.
export type GenerationRunOutcome = "succeeded" | "failed" | "unfinished" | "not-claimed";

// "given-up": its runs were all cut off, so it was ended as "interrupted".
export type GenerationClaim = { outcome: "claimed"; claimed: ClaimedGenerationJob } | { outcome: "given-up" | "not-claimed" };

// Claims and runs one request of one company. Never throws.
export async function runGenerationJob(companyId: string, jobId: string, options: GenerationRunOptions = {}): Promise<GenerationRunOutcome> {
  try {
    const claim = await claimGenerationRun(companyId, jobId);
    return claim.outcome === "claimed" ? await askAndKeep(companyId, jobId, claim.claimed, options) : "not-claimed";
  } catch (error) {
    return unfinishedAfter(error);
  }
}

// Claims one request of one company for a run (ONE UPDATE, so two runs
// never both have it). One cut off as often as allowed is ended
// "interrupted" instead. "Start now" claims before the page answers, so the
// page it gets back already shows the request being made.
export async function claimGenerationRun(companyId: string, jobId: string): Promise<GenerationClaim> {
  const claimed = await claimGenerationJob(companyId, jobId);
  if (claimed) {
    return { outcome: "claimed", claimed };
  }
  return (await giveUpInterruptedJob(companyId, jobId)) ? { outcome: "given-up" } : { outcome: "not-claimed" };
}

// Runs one request this run claimed (claimGenerationRun). Never throws.
export async function runClaimedGenerationJob(
  companyId: string,
  jobId: string,
  claimed: ClaimedGenerationJob,
  options: GenerationRunOptions = {},
): Promise<GenerationRunOutcome> {
  try {
    return await askAndKeep(companyId, jobId, claimed, options);
  } catch (error) {
    return unfinishedAfter(error);
  }
}

// The database failing mid-run: the job stays "being made", and a run 15
// minutes later takes it up.
function unfinishedAfter(error: unknown): GenerationRunOutcome {
  console.error(`Media generation failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
  return "unfinished";
}

// Asks the claimed job's service, then keeps the result or ends it failed.
async function askAndKeep(companyId: string, jobId: string, claimed: ClaimedGenerationJob, options: GenerationRunOptions): Promise<GenerationRunOutcome> {
  const provider = providerForJob(claimed.provider, options.mode ?? currentMediaGenerationMode());
  if (!provider) {
    return endFailed(companyId, jobId, claimed, "provider_unavailable", null);
  }
  const answer = await askProvider(provider, claimed, {
    budgetMs: options.budgetMs ?? GENERATION_RUN_BUDGET_MS,
    sleep: options.sleep,
    saveProviderJobId: (providerJobId) => saveProviderJobId(companyId, jobId, claimed.attempt, providerJobId),
  });
  if (answer.status === "unfinished") {
    return "unfinished";
  }
  if (answer.status === "failed") {
    return endFailed(companyId, jobId, claimed, answer.code, answer.costCents);
  }
  const file = await fetchAndCheckOutput(answer.output, provider, claimed.kind, options.fetcher ?? fetch);
  if ("code" in file) {
    return endFailed(companyId, jobId, claimed, file.code, answer.costCents);
  }
  return keepFile(companyId, jobId, claimed, { provider, file, costCents: answer.costCents });
}

// Stores the file under its company, then saves the asset with the job (and
// the draft) in one transaction. A file whose row isn't saved is removed.
async function keepFile(
  companyId: string,
  jobId: string,
  claimed: ClaimedGenerationJob,
  result: { provider: MediaProvider; file: CheckedFile; costCents: number | null },
): Promise<GenerationRunOutcome> {
  const { file } = result;
  const assetId = randomUUID();
  const storageKey = mediaStorageKey(companyId, assetId, file.contentType);
  try {
    await putPrivateFile(storageKey, file.bytes, file.contentType);
  } catch (error) {
    console.error(`Media generation storage failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return endFailed(companyId, jobId, claimed, "storage_failed", result.costCents);
  }
  const size = readImageSize(file.bytes, file.contentType);
  const asset = {
    assetId,
    storageKey,
    kind: KIND_OF_CONTENT_TYPE[file.contentType],
    contentType: file.contentType,
    sizeBytes: file.bytes.length,
    width: size?.width ?? null,
    height: size?.height ?? null,
    provider: result.provider.name,
    costCents: result.costCents,
  };
  try {
    const saved = await saveGeneratedAsset(companyId, jobId, claimed, asset);
    if (saved === "saved") {
      return "succeeded";
    }
    await removeMediaFile(storageKey);
    if (saved === "lost-claim") {
      return "not-claimed";
    }
    // The job was ended "library_full" in the same transaction.
    console.warn("Media generation failed: library_full");
    return "failed";
  } catch (error) {
    await removeMediaFile(storageKey);
    throw error;
  }
}

// Ends the job as failed with this code, if this run still holds it.
async function endFailed(
  companyId: string,
  jobId: string,
  claimed: ClaimedGenerationJob,
  code: GenerationErrorCode,
  costCents: number | null,
): Promise<GenerationRunOutcome> {
  const ended = await failGenerationJob(companyId, jobId, claimed.attempt, { code, costCents });
  // A fixed code: safe to log, and worth an alert when it repeats.
  console.warn(`Media generation failed: ${code}`);
  return ended ? "failed" : "not-claimed";
}
