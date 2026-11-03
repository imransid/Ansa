"use server";

import { z } from "zod";
import { newestDevMailFromCore, type DevMail } from "@/lib/core-views/dev-mailbox";

// Before a login (the "check your email" pages): the newest email ansa
// "sent" on this computer to the address typed. Core answers only in
// development, with real email off, and limits the looks.
export async function newestDevMailAction(input: { email: string }): Promise<DevMail | null> {
  const parsed = z.object({ email: z.string().trim().min(3).max(254) }).safeParse(input);
  return parsed.success ? newestDevMailFromCore(parsed.data.email) : null;
}
