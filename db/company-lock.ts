import "server-only";
import { eq } from "drizzle-orm";
import type { DbTransaction } from "./client";
import { companies } from "./schema";

// Takes one company's row lock and holds it until the transaction ends.
// Ticket numbering takes the same lock by updating that row
// (db/ticket-creation.ts), so everything that takes it runs one at a time per
// company: team changes (db/team-members.ts), every transaction that routes
// tickets (db/routing.ts says why), saving new knowledge articles (the
// 1,000-article cap, db/knowledge-writes.ts), every write to the
// Co-Founder's interview (db/onboarding-messages.ts says why), saving a
// marketing plan (its version number, db/marketing-plans.ts), changing
// the Co-Founder's setting (db/cofounder-settings.ts) and saving what an
// image service made (the media library's cap, db/media-generation-runs.ts).
// Take it FIRST, before any ticket, person or draft is locked, so two
// transactions never end up waiting for each other.
// "No key update" still lets rows that merely point at the company be written.
export async function lockCompanyRow(tx: DbTransaction, companyId: string): Promise<void> {
  await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("no key update");
}
