import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { calls } from "./schema";

// Records where one company's call recording was stored.
export async function markRecordingStored(companyId: string, callId: string, key: string, contentType: string): Promise<void> {
  await db
    .update(calls)
    .set({ recordingStatus: "stored", recordingKey: key, recordingContentType: contentType })
    .where(and(eq(calls.id, callId), eq(calls.companyId, companyId)));
}

// Records that copying one company's call recording didn't work.
export async function markRecordingFailed(companyId: string, callId: string): Promise<void> {
  await db
    .update(calls)
    .set({ recordingStatus: "failed", recordingKey: null, recordingContentType: null })
    .where(and(eq(calls.id, callId), eq(calls.companyId, companyId)));
}

// Where one company's stored call recording is, if it has one.
export async function getStoredRecording(
  companyId: string,
  callId: string,
): Promise<{ key: string; contentType: string } | undefined> {
  const [call] = await db
    .select({ key: calls.recordingKey, contentType: calls.recordingContentType })
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.companyId, companyId), eq(calls.recordingStatus, "stored")));
  if (!call?.key || !call.contentType) {
    return undefined;
  }
  return { key: call.key, contentType: call.contentType };
}
