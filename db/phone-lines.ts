import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { phoneLines } from "./schema";

export type PhoneLine = typeof phoneLines.$inferSelect;

// Links a Vapi phone number to one company.
export async function createPhoneLine(
  companyId: string,
  vapiPhoneNumberId: string,
): Promise<PhoneLine> {
  const [line] = await db
    .insert(phoneLines)
    .values({ companyId, vapiPhoneNumberId })
    .returning();
  return line;
}

// Finds which company owns a Vapi phone number.
// Not company-scoped on purpose: a webhook arrives with no session, only
// Vapi's number id. Call this only after the webhook signature is verified.
export async function findPhoneLineByVapiNumberId(
  vapiPhoneNumberId: string,
): Promise<{ id: string; companyId: string } | undefined> {
  const [line] = await db
    .select({ id: phoneLines.id, companyId: phoneLines.companyId })
    .from(phoneLines)
    .where(eq(phoneLines.vapiPhoneNumberId, vapiPhoneNumberId));
  return line;
}
