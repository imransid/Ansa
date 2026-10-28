import "server-only";
import { and, count, eq, isNull, notExists } from "drizzle-orm";
import { db } from "./client";
import { getLastInboundEmail, type LastInboundEmail } from "./inbound-emails";
import { getPhoneLinesWithLastCall, type PhoneLineOverview } from "./phone-lines";
import { categories, companies, companyDocuments, inboundAddresses, userCategories, users } from "./schema";
import { canTakeTickets } from "./users";

export type SetupStatus = {
  replyToEmail: string | null;
  // The secret part of the company's forwarding address (lib/forwarding-address.ts).
  inboundToken: string;
  lastInboundEmail: LastInboundEmail | null;
  // Addresses the company's customers write to (display and loop detection only).
  inboundAddresses: string[];
  phoneLines: PhoneLineOverview[];
  activeCategoryCount: number;
  memberCount: number;
  // People who can take tickets but handle no active category: routing by
  // category never picks them (step 29).
  peopleWithoutCategories: number;
  documentCount: number;
};

// Sets (or clears) where customer replies to our emails go (the Reply-To header).
export async function setReplyToEmail(companyId: string, replyToEmail: string | null): Promise<void> {
  await db.update(companies).set({ replyToEmail }).where(eq(companies.id, companyId));
}

// Everything the setup page shows for one company.
export async function getSetupStatus(companyId: string): Promise<SetupStatus> {
  const [company] = await db
    .select({ replyToEmail: companies.replyToEmail, inboundToken: companies.inboundToken })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) {
    throw new Error("The session's company does not exist");
  }
  const addresses = await db.select({ address: inboundAddresses.address }).from(inboundAddresses).where(eq(inboundAddresses.companyId, companyId));
  const [activeCategories] = await db
    .select({ total: count() })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt)));
  // People removed from the team don't count.
  const [members] = await db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), isNull(users.deactivatedAt)));
  const [documents] = await db.select({ total: count() }).from(companyDocuments).where(eq(companyDocuments.companyId, companyId));
  return {
    replyToEmail: company.replyToEmail,
    inboundToken: company.inboundToken,
    lastInboundEmail: (await getLastInboundEmail(companyId)) ?? null,
    inboundAddresses: addresses.map((row) => row.address),
    phoneLines: await getPhoneLinesWithLastCall(companyId),
    activeCategoryCount: activeCategories?.total ?? 0,
    memberCount: members?.total ?? 0,
    peopleWithoutCategories: await countPeopleWithoutCategories(companyId),
    documentCount: documents?.total ?? 0,
  };
}

// How many of one company's people who can take tickets (confirmed, not
// removed) handle no active category.
async function countPeopleWithoutCategories(companyId: string): Promise<number> {
  const handlesAnActiveCategory = db
    .select({ userId: userCategories.userId })
    .from(userCategories)
    .innerJoin(categories, and(eq(categories.id, userCategories.categoryId), eq(categories.companyId, userCategories.companyId)))
    .where(and(eq(userCategories.companyId, companyId), eq(userCategories.userId, users.id), isNull(categories.archivedAt)));
  const [people] = await db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), canTakeTickets, notExists(handlesAnActiveCategory)));
  return people?.total ?? 0;
}
