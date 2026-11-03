"use server";

import { z } from "zod";
import { newestDevMailFromCore, type NewestDevMail } from "@/lib/core-views/dev-mailbox";

// Before a login (the "check your email" pages): the newest email ansa
// "sent" on this computer to the address typed. Core answers only in
// development, with real email off, for made-up addresses, and limits the
// looks.
export async function newestDevMailAction(input: { email: string }): Promise<NewestDevMail> {
  const parsed = z.object({ email: z.string().trim().min(3).max(254) }).safeParse(input);
  return parsed.success ? newestDevMailFromCore(parsed.data.email) : { email: null, problem: "Write the email address you used." };
}
