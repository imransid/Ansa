import "server-only";
import { callCore } from "@/lib/core-api";
import { callPath } from "@/lib/core-views/calls";
import type { PrivateFileAccess } from "@/lib/file-storage";

// A recording through the new backend: a signed link (R2), or in
// development the bytes as base64.
type CoreRecording = { url: string } | { contentType: string; data: string };

// A call's recording: core's 5-minute signed link, or in development the
// bytes. "rate-limited" after too many plays (the route answers 429, never
// 404); null for no recording, a bad id or another company's call.
export async function getRecordingFromCore(callId: string): Promise<PrivateFileAccess | "rate-limited" | null> {
  const path = callPath(callId, "/recording");
  if (!path) {
    return null;
  }
  const answer = await callCore<CoreRecording>("GET", path);
  if (!answer.ok && answer.status === 429) {
    return "rate-limited";
  }
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  if ("url" in answer.data) {
    return { kind: "signed-url", url: answer.data.url };
  }
  return { kind: "bytes", bytes: Buffer.from(answer.data.data, "base64"), contentType: answer.data.contentType };
}
