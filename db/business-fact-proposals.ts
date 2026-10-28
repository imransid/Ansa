import "server-only";
import { and, sql } from "drizzle-orm";
import { businessFactTopics, type BusinessFactTopic, type FactProposalSource } from "@/lib/business-facts";
import type { FactProposal } from "@/lib/cofounder/fact-proposals";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { db, type DbTransaction } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import { businessFacts } from "./schema";

// Saving the AI's proposals into one company's business profile (step 36),
// from the interview (db/onboarding-messages.ts) and from a knowledge
// article (below). A proposal goes BESIDE the confirmed value, never over
// it: only an owner's Confirm makes it the fact (db/business-facts.ts).

// Saves proposals for one company inside the caller's transaction, which
// has checked the person. One equal to the confirmed value, or to the
// proposal already waiting, writes nothing: there is nothing new to confirm.
// Returns the topics that got a new proposal. Rows are written in the order
// of the topic list, so two saves at the same moment (an interview turn and
// a suggestion) lock them in the same order and can't wait for each other.
export async function saveFactProposals(
  tx: DbTransaction,
  companyId: string,
  proposals: FactProposal[],
  source: FactProposalSource,
): Promise<BusinessFactTopic[]> {
  const inTopicOrder = businessFactTopics.flatMap((topic) => proposals.filter((proposal) => proposal.topic === topic));
  const written: BusinessFactTopic[] = [];
  for (const proposal of inTopicOrder) {
    // Every column named: the confirmed columns are never part of this write.
    const proposalColumns = { proposedValue: proposal.value, proposedSource: source, proposedAt: sql`now()` };
    const saved = await tx
      .insert(businessFacts)
      .values({ companyId, topic: proposal.topic, ...proposalColumns })
      .onConflictDoUpdate({
        target: [businessFacts.companyId, businessFacts.topic],
        set: { ...proposalColumns, updatedAt: sql`now()` },
        setWhere: and(
          sql`${businessFacts.confirmedValue} IS DISTINCT FROM ${proposal.value}`,
          sql`${businessFacts.proposedValue} IS DISTINCT FROM ${proposal.value}`,
        ),
      })
      .returning({ topic: businessFacts.topic });
    written.push(...saved.map((row) => row.topic));
  }
  return written;
}

export type KnowledgeProposalsOutcome = { outcome: "saved"; proposedTopics: BusinessFactTopic[] } | { outcome: "not-allowed" };

// Saves the proposals Claude made from a knowledge article an owner picked
// ("Suggest facts from knowledge"), while that person is still an active
// owner of the company (read again, locked).
export async function saveKnowledgeFactProposals(
  companyId: string,
  actorUserId: string,
  proposals: FactProposal[],
): Promise<KnowledgeProposalsOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageBusinessProfile(role)) {
      return { outcome: "not-allowed" };
    }
    return { outcome: "saved", proposedTopics: await saveFactProposals(tx, companyId, proposals, "knowledge") };
  });
}
