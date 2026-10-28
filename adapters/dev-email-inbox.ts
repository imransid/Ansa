import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Not a real vendor: the stand-in for Resend's Receiving API whenever
// SEND_REAL_EMAIL is not "true". pnpm simulate:inbound-email writes each
// made-up email to .dev-inbound/<id>.json (git-ignored); this reads it back.
const INBOX_DIR = path.join(process.cwd(), ".dev-inbound");

// The stand-in file of one received email, parsed but not checked yet
// (lib/inbound-email.ts does that), or null when there is none.
export async function readFromDevInbox(resendEmailId: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(INBOX_DIR, `${resendEmailId}.json`), "utf8"));
  } catch {
    return null;
  }
}
