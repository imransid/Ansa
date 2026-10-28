import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { BusinessFactTopic, FactConfirmationSource, FactProposalSource } from "@/lib/business-facts";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { db, type DbTransaction } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import { businessFacts, users } from "./schema";

// One company's business profile (step 36): reading it, and what an owner
// does with it (confirm or dismiss a proposal, type a fact). Saving the AI's
// proposals: db/business-fact-proposals.ts. The owner's role is read again,
// locked, in every transaction that writes (db/knowledge-author.ts says why).

export type BusinessFactRow = {
  topic: BusinessFactTopic;
  confirmedValue: string | null;
  confirmedSource: FactConfirmationSource | null;
  confirmedAt: Date | null;
  // Who confirmed it, read within the company.
  confirmedByName: string | null;
  proposedValue: string | null;
  proposedSource: FactProposalSource | null;
  proposedAt: Date | null;
};

// "stale": the stored value is no longer the one the page showed (someone
// changed it, or a newer proposal came, meanwhile): nothing was written.
export type FactChangeOutcome = "changed" | "unchanged" | "stale" | "not-allowed";

// Every topic of one company's profile that has a row (a topic without one
// is missing).
export async function getBusinessFactsForCompany(companyId: string): Promise<BusinessFactRow[]> {
  return db
    .select({
      topic: businessFacts.topic,
      confirmedValue: businessFacts.confirmedValue,
      confirmedSource: businessFacts.confirmedSource,
      confirmedAt: businessFacts.confirmedAt,
      confirmedByName: users.name,
      proposedValue: businessFacts.proposedValue,
      proposedSource: businessFacts.proposedSource,
      proposedAt: businessFacts.proposedAt,
    })
    .from(businessFacts)
    // company_id matched too, so a name from another company can never show up.
    .leftJoin(users, and(eq(users.id, businessFacts.confirmedByUserId), eq(users.companyId, businessFacts.companyId)))
    .where(eq(businessFacts.companyId, companyId));
}

// One company's confirmed facts as { topic, value }, read inside the
// caller's transaction: approving a content draft (db/content-draft-status.ts,
// step 38) checks its claims and words to avoid against them where it writes.
export async function readConfirmedFactValues(tx: DbTransaction, companyId: string): Promise<{ topic: string; value: string }[]> {
  const rows = await tx
    .select({ topic: businessFacts.topic, value: businessFacts.confirmedValue })
    .from(businessFacts)
    .where(and(eq(businessFacts.companyId, companyId), isNotNull(businessFacts.confirmedValue)));
  return rows.flatMap((row) => (row.value ? [{ topic: row.topic, value: row.value }] : []));
}

// Makes one company's waiting proposal its fact: the value as the page
// showed it (Confirm), or the owner's edit of it (Edit and confirm, then the
// source is "owner"). The UPDATE requires the proposal AND the confirmed
// value beside it (null: none) to still be exactly the ones shown, so nobody
// confirms words they didn't see or replaces a value they never saw: a newer
// proposal, one dismissed meanwhile, or a fact another owner saved meanwhile
// is "stale". The proposal is cleared.
export async function confirmBusinessFactProposal(
  companyId: string,
  actorUserId: string,
  confirmation: { topic: BusinessFactTopic; shownProposal: string; shownConfirmedValue: string | null; value: string },
): Promise<FactChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageBusinessProfile(role)) {
      return "not-allowed";
    }
    // SET reads the row as it was, so this is the proposal's own source.
    const source = confirmation.value === confirmation.shownProposal ? sql`${businessFacts.proposedSource}` : "owner";
    const confirmed = await tx
      .update(businessFacts)
      .set({
        confirmedValue: confirmation.value,
        confirmedSource: source,
        confirmedByUserId: actorUserId,
        confirmedAt: sql`now()`,
        proposedValue: null,
        proposedSource: null,
        proposedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(businessFacts.companyId, companyId),
          eq(businessFacts.topic, confirmation.topic),
          eq(businessFacts.proposedValue, confirmation.shownProposal),
          sql`${businessFacts.confirmedValue} IS NOT DISTINCT FROM ${confirmation.shownConfirmedValue}`,
        ),
      )
      .returning({ id: businessFacts.id });
    return confirmed.length > 0 ? "changed" : "stale";
  });
}

// Clears one company's waiting proposal, when it is still the one the page
// showed ("stale" otherwise: a newer one stays). The confirmed value stays.
export async function dismissBusinessFactProposal(
  companyId: string,
  actorUserId: string,
  dismissal: { topic: BusinessFactTopic; shownProposal: string },
): Promise<FactChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageBusinessProfile(role)) {
      return "not-allowed";
    }
    const dismissed = await tx
      .update(businessFacts)
      .set({ proposedValue: null, proposedSource: null, proposedAt: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(businessFacts.companyId, companyId),
          eq(businessFacts.topic, dismissal.topic),
          eq(businessFacts.proposedValue, dismissal.shownProposal),
        ),
      )
      .returning({ id: businessFacts.id });
    return dismissed.length > 0 ? "changed" : "stale";
  });
}

// Saves an owner's own value for one topic of one company, confirmed at once
// (source "owner"). originalValue is the confirmed value the editor opened
// with (null: none): when the stored one differs, someone changed the fact
// meanwhile and nothing is saved ("stale"). A proposal waiting beside it
// stays, unless it says the same as the new value: then it is cleared, as
// there is nothing left to confirm.
export async function saveBusinessFactValue(
  companyId: string,
  actorUserId: string,
  edit: { topic: BusinessFactTopic; originalValue: string | null; value: string },
): Promise<FactChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageBusinessProfile(role)) {
      return "not-allowed";
    }
    const [current] = await tx
      .select({ confirmedValue: businessFacts.confirmedValue, proposedValue: businessFacts.proposedValue })
      .from(businessFacts)
      .where(and(eq(businessFacts.companyId, companyId), eq(businessFacts.topic, edit.topic)))
      .for("update");
    const currentValue = current?.confirmedValue ?? null;
    if (currentValue !== edit.originalValue) {
      return "stale";
    }
    if (currentValue === edit.value) {
      return "unchanged";
    }
    const confirmation = { confirmedValue: edit.value, confirmedSource: "owner" as const, confirmedByUserId: actorUserId, confirmedAt: sql`now()` };
    const clearedProposal = { proposedValue: null, proposedSource: null, proposedAt: null };
    const changes = current?.proposedValue === edit.value ? { ...confirmation, ...clearedProposal } : confirmation;
    const saved = await tx
      .insert(businessFacts)
      .values({ companyId, topic: edit.topic, ...confirmation })
      .onConflictDoUpdate({
        target: [businessFacts.companyId, businessFacts.topic],
        set: { ...changes, updatedAt: sql`now()` },
        // Two first saves at the same moment both found no row to lock: the
        // later one must not overwrite the earlier one unseen.
        setWhere: sql`${businessFacts.confirmedValue} IS NOT DISTINCT FROM ${edit.originalValue}`,
      })
      .returning({ id: businessFacts.id });
    return saved.length > 0 ? "changed" : "stale";
  });
}
