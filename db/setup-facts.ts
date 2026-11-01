import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { BusinessFactTopic } from "@/lib/business-facts";
import type { DbTransaction } from "./client";
import { businessFacts } from "./schema";

// Sets one business fact as the owner's own (source "owner", confirmed at
// once) inside a transaction that already checked the owner: the restaurant
// setup's name, description and location (db/restaurant-setup.ts), so posts
// can use them too. Unlike the Profile page's edit (saveBusinessFactValue,
// db/business-facts.ts) there is no "what the page showed" check: the setup
// form shows the current value and the owner's words become the fact. A
// waiting proposal that says the same is cleared, as there is nothing left
// to confirm; any other stays for the owner to look at.
export async function setOwnerFactWithin(
  tx: DbTransaction,
  companyId: string,
  actorUserId: string,
  topic: BusinessFactTopic,
  value: string,
): Promise<void> {
  const [current] = await tx
    .select({ confirmedValue: businessFacts.confirmedValue, proposedValue: businessFacts.proposedValue })
    .from(businessFacts)
    .where(and(eq(businessFacts.companyId, companyId), eq(businessFacts.topic, topic)))
    .for("update");
  if (current?.confirmedValue === value) {
    return;
  }
  const confirmation = { confirmedValue: value, confirmedSource: "owner" as const, confirmedByUserId: actorUserId, confirmedAt: sql`now()` };
  const clearedProposal = { proposedValue: null, proposedSource: null, proposedAt: null };
  const changes = current?.proposedValue === value ? { ...confirmation, ...clearedProposal } : confirmation;
  await tx
    .insert(businessFacts)
    .values({ companyId, topic, ...confirmation })
    .onConflictDoUpdate({ target: [businessFacts.companyId, businessFacts.topic], set: { ...changes, updatedAt: sql`now()` } });
}
