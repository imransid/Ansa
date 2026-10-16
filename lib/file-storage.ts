import "server-only";
import { putToDevFiles, readFromDevFiles } from "@/adapters/dev-file-storage";
import { putToR2, signedR2DownloadUrl } from "@/adapters/r2";
import { env } from "@/lib/env";

// Private file storage (call recordings now, uploaded docs later). Core code
// calls these two functions; it never talks to R2 or the dev folder directly.

// How a stored file can be reached: a short-lived signed R2 link, or (in dev)
// the bytes themselves, served by our own route after its login check.
export type PrivateFileAccess =
  | { kind: "signed-url"; url: string }
  | { kind: "bytes"; bytes: Buffer; contentType: string };

// Keys are made by our code only, from ids: letters, digits, / . _ -
const SAFE_KEY = /^[a-z0-9][a-z0-9/._-]*$/;

export function isR2On(): boolean {
  return env.USE_R2_STORAGE === "true";
}

export async function putPrivateFile(key: string, bytes: Buffer, contentType: string): Promise<void> {
  assertSafeKey(key);
  if (isR2On()) {
    await putToR2(key, bytes, contentType);
    return;
  }
  await putToDevFiles(key, bytes);
}

// Returns a way to reach the file, or null if it can't be found.
// linkSeconds: how long a signed link works.
export async function getPrivateFileAccess(key: string, contentType: string, linkSeconds: number): Promise<PrivateFileAccess | null> {
  assertSafeKey(key);
  if (isR2On()) {
    return { kind: "signed-url", url: await signedR2DownloadUrl(key, linkSeconds) };
  }
  const bytes = await readFromDevFiles(key);
  return bytes ? { kind: "bytes", bytes, contentType } : null;
}

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..")) {
    throw new Error("Unsafe file key");
  }
}
