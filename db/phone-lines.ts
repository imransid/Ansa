import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { calls, phoneLines } from "./schema";

export type PhoneLine = typeof phoneLines.$inferSelect;

// A phone number as its company's Setup page shows it.
export type PhoneLineOverview = {
  vapiPhoneNumberId: string;
  // When the last call on it was saved; null until the first call.
  lastCallAt: Date | null;
};

// Links a Vapi phone number to one company. Called by ansa's operator script
// (pnpm link:phone-line) and the checks: owners can't link numbers themselves.
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

// Unlinks one of a company's phone numbers (pnpm unlink:phone-line). Postgres
// refuses (foreign key) once the number has calls. Returns false if the
// company has no such number.
export async function deletePhoneLine(companyId: string, vapiPhoneNumberId: string): Promise<boolean> {
  const deleted = await db
    .delete(phoneLines)
    .where(and(eq(phoneLines.companyId, companyId), eq(phoneLines.vapiPhoneNumberId, vapiPhoneNumberId)))
    .returning({ id: phoneLines.id });
  return deleted.length > 0;
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

// One company's phone numbers, oldest first, each with the time of its last
// saved call. A number that never gets calls is linked wrong, or not live yet.
export async function getPhoneLinesWithLastCall(companyId: string): Promise<PhoneLineOverview[]> {
  const lines = await db
    .select({ id: phoneLines.id, vapiPhoneNumberId: phoneLines.vapiPhoneNumberId })
    .from(phoneLines)
    .where(eq(phoneLines.companyId, companyId))
    .orderBy(asc(phoneLines.createdAt), asc(phoneLines.id));
  // WHY one small query per number (a company has only a few): each reads
  // only that number's newest call, from calls_company_id_phone_line_id_created_at_idx.
  // One max() over a join would read every call the company ever had.
  const overview: PhoneLineOverview[] = [];
  for (const line of lines) {
    overview.push({ vapiPhoneNumberId: line.vapiPhoneNumberId, lastCallAt: await getLastCallAt(companyId, line.id) });
  }
  return overview;
}

// When the newest call on one of a company's numbers was saved, or null.
async function getLastCallAt(companyId: string, phoneLineId: string): Promise<Date | null> {
  const [newest] = await db
    .select({ createdAt: calls.createdAt })
    .from(calls)
    .where(and(eq(calls.companyId, companyId), eq(calls.phoneLineId, phoneLineId)))
    .orderBy(desc(calls.createdAt))
    .limit(1);
  return newest?.createdAt ?? null;
}
