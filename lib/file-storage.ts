import "server-only";
import { deleteFromDevFiles, putToDevFiles, readFromDevFiles } from "@/adapters/dev-file-storage";
import { deleteFromR2, putToR2, signedR2DownloadUrl } from "@/adapters/r2";
import { env } from "@/lib/env";

// Private file storage (call recordings, uploaded documents). Core code
// calls these functions; it never talks to R2 or the dev folder directly.

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
// linkSeconds: how long a signed link works. downloadName: save, don't open.
export async function getPrivateFileAccess(key: string, contentType: string, linkSeconds: number, downloadName?: string): Promise<PrivateFileAccess | null> {
  assertSafeKey(key);
  if (isR2On()) {
    return { kind: "signed-url", url: await signedR2DownloadUrl(key, linkSeconds, downloadName) };
  }
  const bytes = await readFromDevFiles(key);
  return bytes ? { kind: "bytes", bytes, contentType } : null;
}

export async function deletePrivateFile(key: string): Promise<void> {
  assertSafeKey(key);
  if (isR2On()) {
    await deleteFromR2(key);
    return;
  }
  await deleteFromDevFiles(key);
}

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..")) {
    throw new Error("Unsafe file key");
  }
}
