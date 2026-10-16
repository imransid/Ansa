import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { env } from "@/lib/env";

// Fetches the content of one received email. The webhook only says "an email
// arrived"; the subject and body come from here.
// - With RESEND_API_KEY: Resend's Receiving API.
// - Without: the stand-in, .dev-inbound/<id>.json, written by
//   pnpm simulate:inbound-email.

export type InboundEmailContent = {
  from: string;
  to: string[];
  subject: string;
  text: string | null;
  headers: Record<string, string>;
};

const DEV_INBOUND_DIR = path.join(process.cwd(), ".dev-inbound");
// Resend ids are uuid-like; anything else never reaches the file system or the API.
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export async function fetchInboundEmail(resendEmailId: string): Promise<InboundEmailContent | null> {
  if (!SAFE_ID.test(resendEmailId)) {
    return null;
  }
  if (env.RESEND_API_KEY) {
    const { data, error } = await new Resend(env.RESEND_API_KEY).emails.receiving.get(resendEmailId);
    if (error || !data) {
      return null;
    }
    return { from: data.from, to: data.to, subject: data.subject, text: data.text, headers: data.headers ?? {} };
  }
  try {
    const json = JSON.parse(await readFile(path.join(DEV_INBOUND_DIR, `${resendEmailId}.json`), "utf8"));
    return { from: json.from, to: json.to, subject: json.subject, text: json.text ?? null, headers: json.headers ?? {} };
  } catch {
    return null;
  }
}
