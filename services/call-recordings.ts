import "server-only";
import { getStoredRecording, markRecordingFailed, markRecordingStored } from "@/db/call-recordings";
import { env } from "@/lib/env";
import { getPrivateFileAccess, putPrivateFile, type PrivateFileAccess } from "@/lib/file-storage";
import { downloadRecording, isAllowedRecordingUrl, type Fetcher } from "@/lib/recording-download";
import type { SessionContext } from "@/lib/session";
import { callIdSchema } from "@/lib/validation/vapi";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE for this file: never log a recording URL, a file key or an
// error message. Fixed strings and class names only.

const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
// How long a signed link to a recording works.
const RECORDING_LINK_SECONDS = 5 * 60;

const FILE_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

// The hosts recordings may be copied from (VAPI_RECORDING_HOSTS), lowercase.
export function allowedRecordingHosts(): string[] {
  return env.VAPI_RECORDING_HOSTS.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
}

// Says whether the webhook should try to copy this recording at all.
export function isCopyableRecordingUrl(url: string): boolean {
  return isAllowedRecordingUrl(url, allowedRecordingHosts());
}

type StoreOptions = { fetcher?: Fetcher; maxBytes?: number };

// Copies one call's recording from Vapi into private storage (step 14).
// Runs after the webhook has answered Vapi. Never throws. The options are only
// changed by the checks.
export async function storeCallRecording(
  companyId: string,
  callId: string,
  recordingUrl: string,
  { fetcher = fetch, maxBytes = MAX_RECORDING_BYTES }: StoreOptions = {},
): Promise<"stored" | "failed"> {
  try {
    const recording = await downloadRecording(recordingUrl, allowedRecordingHosts(), maxBytes, fetcher);
    if (!recording) {
      await markRecordingFailed(companyId, callId);
      return "failed";
    }
    const extension = FILE_EXTENSIONS[recording.contentType] ?? "audio";
    // The company id in the key keeps every company's files apart in the bucket.
    const key = `recordings/${companyId}/${callId}.${extension}`;
    await putPrivateFile(key, recording.bytes, recording.contentType);
    await markRecordingStored(companyId, callId, key, recording.contentType);
    return "stored";
  } catch (error) {
    console.error(`Recording copy failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    await markRecordingFailed(companyId, callId).catch(() => {});
    return "failed";
  }
}

// What the call page's player gets for one call of the session's company: a
// 5-minute signed link (R2), or the bytes (dev). Null for an unknown call, a
// call without a stored recording, or another company's call; "rate-limited"
// after too many plays (the route answers 429, never a misleading 404).
export async function getRecordingForSession(session: SessionContext, callId: unknown): Promise<PrivateFileAccess | "rate-limited" | null> {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) {
    return null;
  }
  if (await isOverRateLimit("recording-views", session.userId, RATE_LIMITS.recordingViewsPerUser)) {
    return "rate-limited";
  }
  const stored = await getStoredRecording(session.companyId, parsed.data);
  if (!stored) {
    return null;
  }
  return getPrivateFileAccess(stored.key, stored.contentType, RECORDING_LINK_SECONDS);
}
