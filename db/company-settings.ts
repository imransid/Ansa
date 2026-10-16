import "server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import { categories, companies, companyDocuments, inboundAddresses, phoneLines, users } from "./schema";

export type SetupStatus = {
  replyToEmail: string | null;
  phoneLines: string[];
  inboundAddresses: string[];
  activeCategoryCount: number;
  memberCount: number;
  documentCount: number;
};

// Sets (or clears) where customer replies to our emails go (the Reply-To header).
export async function setReplyToEmail(companyId: string, replyToEmail: string | null): Promise<void> {
  await db.update(companies).set({ replyToEmail }).where(eq(companies.id, companyId));
}

// Everything the setup checklist shows for one company.
export async function getSetupStatus(companyId: string): Promise<SetupStatus> {
  const [company] = await db.select({ replyToEmail: companies.replyToEmail }).from(companies).where(eq(companies.id, companyId));
  const lines = await db.select({ id: phoneLines.vapiPhoneNumberId }).from(phoneLines).where(eq(phoneLines.companyId, companyId));
  const addresses = await db.select({ address: inboundAddresses.address }).from(inboundAddresses).where(eq(inboundAddresses.companyId, companyId));
  const [activeCategories] = await db
    .select({ total: count() })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt)));
  const [members] = await db.select({ total: count() }).from(users).where(eq(users.companyId, companyId));
  const [documents] = await db.select({ total: count() }).from(companyDocuments).where(eq(companyDocuments.companyId, companyId));
  return {
    replyToEmail: company?.replyToEmail ?? null,
    phoneLines: lines.map((line) => line.id),
    inboundAddresses: addresses.map((row) => row.address),
    activeCategoryCount: activeCategories?.total ?? 0,
    memberCount: members?.total ?? 0,
    documentCount: documents?.total ?? 0,
  };
}
