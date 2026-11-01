import "server-only";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { BusinessType, CompanyKind } from "@/lib/restaurant-setup";
import { DEFAULT_HOLDING_REPLY, personalHoldingReply, savedSetupSteps } from "@/lib/restaurant-setup";
import { db, type DbTransaction } from "./client";
import { asRestaurantOwner, recordSetupProgressWithin, type SetupWriteOutcome } from "./restaurant-owner";
import { assistantSettings, companies } from "./schema";
import { setOwnerFactWithin } from "./setup-facts";

// The restaurant setup of one company (step 45): where the owner is in it,
// and the steps that write the company itself or its business facts. The
// assistant's own settings: db/assistant-settings.ts. Every write is an
// owner's, checked again inside its transaction (db/restaurant-owner.ts).

export type CompanySetupRow = {
  companyName: string;
  kind: CompanyKind;
  businessType: BusinessType | null;
  setupProgress: number;
  setupFinishedAt: Date | null;
};

// Where one company is in its setup.
export async function getCompanySetup(companyId: string): Promise<CompanySetupRow> {
  const [company] = await db
    .select({
      companyName: companies.name,
      kind: companies.kind,
      businessType: companies.businessType,
      setupProgress: companies.setupProgress,
      setupFinishedAt: companies.setupFinishedAt,
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) {
    throw new Error("The session's company does not exist");
  }
  return company;
}

// Step 1: who ansa is for (step 50: a business, or one person), the name
// (also the sender name of customer emails, "<name> via ansa"), what kind
// of business it is, and what it serves or what the person does. The name
// and description are business facts too. Changing who it is for starts
// the setup's later steps again (their list differs), switches when ansa
// answers (a person's: only while away) and the holding reply, unless the
// owner wrote their own.
export async function saveBusinessSection(
  companyId: string,
  actorUserId: string,
  section: { kind: CompanyKind; companyName: string; businessType: BusinessType | null; description: string },
  reached: number | null,
): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const [before] = await tx.select({ kind: companies.kind, name: companies.name }).from(companies).where(eq(companies.id, companyId));
    await tx
      .update(companies)
      .set({ name: section.companyName, kind: section.kind, businessType: section.businessType })
      .where(eq(companies.id, companyId));
    await setOwnerFactWithin(tx, companyId, actorUserId, "company_name", section.companyName);
    if (section.description) {
      await setOwnerFactWithin(tx, companyId, actorUserId, "description", section.description);
    }
    await followKindWithin(tx, companyId, actorUserId, { kind: before.kind, name: before.name }, section);
    if (before.kind !== section.kind && reached !== null) {
      await tx.update(companies).set({ setupProgress: reached }).where(eq(companies.id, companyId));
      return;
    }
    await recordSetupProgressWithin(tx, companyId, reached);
  });
}

// The assistant's defaults that depend on who it is for: when it answers,
// and the holding reply while it is still one of ansa's own (never one the
// owner wrote).
async function followKindWithin(
  tx: DbTransaction,
  companyId: string,
  actorUserId: string,
  before: { kind: CompanyKind; name: string },
  now: { kind: CompanyKind; companyName: string },
): Promise<void> {
  const [settings] = await tx.select({ holdingReply: assistantSettings.holdingReply }).from(assistantSettings).where(eq(assistantSettings.companyId, companyId));
  const current = settings?.holdingReply ?? DEFAULT_HOLDING_REPLY;
  const ansasOwn = current === DEFAULT_HOLDING_REPLY || current === personalHoldingReply(before.name);
  const holdingReply = ansasOwn ? (now.kind === "personal" ? personalHoldingReply(now.companyName) : DEFAULT_HOLDING_REPLY) : current;
  const columns =
    before.kind === now.kind
      ? { holdingReply, updatedByUserId: actorUserId }
      : { holdingReply, answerWhen: now.kind === "personal" ? ("when_away" as const) : ("always" as const), updatedByUserId: actorUserId };
  await tx
    .insert(assistantSettings)
    .values({ companyId, ...columns })
    .onConflictDoUpdate({ target: assistantSettings.companyId, set: { ...columns, updatedAt: sql`now()` } });
}

// Step 2: the address (the "location" business fact) and the number
// customers may call (null: none).
export async function saveContactSection(
  companyId: string,
  actorUserId: string,
  section: { address: string; phone: string | null },
  reached: number | null,
): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    await setOwnerFactWithin(tx, companyId, actorUserId, "location", section.address);
    await tx
      .insert(assistantSettings)
      .values({ companyId, publicPhone: section.phone, updatedByUserId: actorUserId })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { publicPhone: section.phone, updatedByUserId: actorUserId, updatedAt: sql`now()` } });
    await recordSetupProgressWithin(tx, companyId, reached);
  });
}

// Step 6, "Your channels", saves nothing of its own: moving past it counts.
export async function recordChannelsStepDone(companyId: string, actorUserId: string, reached: number): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    await recordSetupProgressWithin(tx, companyId, reached);
  });
}

// "Your assistant is ready": setup is finished once every step was saved.
// "not-ready": a step is still missing (the page sends the owner to it).
export async function finishSetup(companyId: string, actorUserId: string): Promise<SetupWriteOutcome | "not-ready"> {
  let finished = false;
  const outcome = await asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const updated = await tx
      .update(companies)
      .set({ setupFinishedAt: sql`now()` })
      .where(
        and(
          eq(companies.id, companyId),
          // A person's setup has fewer steps (step 50).
          gte(companies.setupProgress, sql`CASE WHEN ${companies.kind} = 'personal' THEN ${savedSetupSteps("personal")}::int ELSE ${savedSetupSteps("business")}::int END`),
          isNull(companies.setupFinishedAt),
        ),
      )
      .returning({ id: companies.id });
    const [company] = await tx.select({ finishedAt: companies.setupFinishedAt }).from(companies).where(eq(companies.id, companyId));
    finished = updated.length > 0 || company?.finishedAt !== null;
  });
  if (outcome === "saved" && !finished) {
    return "not-ready";
  }
  return outcome;
}
