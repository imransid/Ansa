import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { canManagePublishing } from "@/lib/cofounder/permissions";
import type { RuleForCheck } from "@/lib/publishing/run-check";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db, type DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { lockActiveAuthorRole } from "./knowledge-author";
import { autopublishRules, users } from "./schema";

// One company's auto-publish rules (step 41): the list, making one (always
// switched off) and switching one on or off, owners only (the role read
// again, locked, in the transaction: db/knowledge-author.ts says why), each
// change recorded in the activity log. Nothing here, or anywhere, turns a
// rule on by itself: only an owner's explicit confirm does.

export type AutopublishRuleListItem = {
  id: string;
  platform: SocialPlatform;
  pillar: string;
  enabled: boolean;
  createdAt: Date;
  createdByName: string | null;
  enabledAt: Date | null;
  enabledByName: string | null;
};

export type RuleChangeOutcome = "changed" | "unchanged" | "not-found" | "not-allowed";

const creator = alias(users, "creator");
const enabler = alias(users, "enabler");

// Lists one company's rules, by platform and pillar ("any pillar" first).
export async function listAutopublishRules(companyId: string): Promise<AutopublishRuleListItem[]> {
  return db
    .select({
      id: autopublishRules.id,
      platform: autopublishRules.platform,
      pillar: autopublishRules.pillar,
      enabled: autopublishRules.enabled,
      createdAt: autopublishRules.createdAt,
      createdByName: creator.name,
      enabledAt: autopublishRules.enabledAt,
      enabledByName: enabler.name,
    })
    .from(autopublishRules)
    .leftJoin(creator, and(eq(creator.companyId, autopublishRules.companyId), eq(creator.id, autopublishRules.createdByUserId)))
    .leftJoin(enabler, and(eq(enabler.companyId, autopublishRules.companyId), eq(enabler.id, autopublishRules.enabledByUserId)))
    .where(eq(autopublishRules.companyId, companyId))
    .orderBy(asc(autopublishRules.platform), asc(autopublishRules.pillar), asc(autopublishRules.id));
}

// Makes a rule for one platform and pillar ("" = any) of one company,
// switched OFF, while actorUserId is an active owner. "exists": the company
// has one for that platform and pillar already (whatever the pillar's case).
export async function createAutopublishRule(
  companyId: string,
  actorUserId: string,
  rule: { platform: SocialPlatform; pillar: string },
): Promise<{ outcome: "created"; ruleId: string } | { outcome: "exists" | "not-allowed" }> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManagePublishing(role)) {
      return { outcome: "not-allowed" };
    }
    const [created] = await tx
      .insert(autopublishRules)
      .values({ companyId, platform: rule.platform, pillar: rule.pillar, enabled: false, createdByUserId: actorUserId })
      .onConflictDoNothing()
      .returning({ id: autopublishRules.id });
    if (!created) {
      return { outcome: "exists" };
    }
    await recordActivity(tx, companyId, [{ action: "rule_created", actorUserId, ruleId: created.id }]);
    return { outcome: "created", ruleId: created.id };
  });
}

// Switches one of the company's rules on (naming who did it, and when) or
// off, while actorUserId is an active owner. Posts already scheduled under
// a rule switched off fail when they run (lib/publishing/run-check.ts).
export async function setAutopublishRuleEnabled(companyId: string, actorUserId: string, ruleId: string, enabled: boolean): Promise<RuleChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManagePublishing(role)) {
      return "not-allowed";
    }
    const [rule] = await tx
      .select({ enabled: autopublishRules.enabled })
      .from(autopublishRules)
      .where(and(eq(autopublishRules.companyId, companyId), eq(autopublishRules.id, ruleId)))
      .for("update");
    if (!rule) {
      return "not-found";
    }
    if (rule.enabled === enabled) {
      return "unchanged";
    }
    const turnedOn = enabled ? { enabledByUserId: actorUserId, enabledAt: sql`now()` } : { enabledByUserId: null, enabledAt: null };
    await tx
      .update(autopublishRules)
      .set({ enabled, ...turnedOn, updatedAt: sql`now()` })
      .where(and(eq(autopublishRules.companyId, companyId), eq(autopublishRules.id, ruleId)));
    await recordActivity(tx, companyId, [{ action: enabled ? "rule_enabled" : "rule_disabled", actorUserId, ruleId }]);
    return "changed";
  });
}

// The enabled rule of one company that would cover a draft (its own pillar
// first, then any pillar), for a draft's page to offer "without an
// approval"; scheduling decides again, locked (lockRuleCoveringDraft).
export async function findRuleCoveringDraft(
  companyId: string,
  draft: { platform: SocialPlatform; pillar: string },
): Promise<{ id: string; platform: SocialPlatform; pillar: string } | null> {
  const [rule] = await db
    .select({ id: autopublishRules.id, platform: autopublishRules.platform, pillar: autopublishRules.pillar })
    .from(autopublishRules)
    .where(coveringDraft(companyId, draft))
    .orderBy(sql`${autopublishRules.pillar} = ''`)
    .limit(1);
  return rule ?? null;
}

// Inside a scheduling transaction: the enabled rule of one company covering
// a draft best (one for its own pillar first, then one for any pillar),
// locked FOR SHARE so it can't be switched off until the post is saved,
// with whether the owners behind it (who made it, who turned it on) are
// still active owners, their rows locked FOR SHARE too. Null: none.
export async function lockRuleCoveringDraft(
  tx: DbTransaction,
  companyId: string,
  draft: { platform: SocialPlatform; pillar: string },
): Promise<(RuleForCheck & { id: string }) | null> {
  const [rule] = await tx
    .select({
      id: autopublishRules.id,
      platform: autopublishRules.platform,
      pillar: autopublishRules.pillar,
      createdByUserId: autopublishRules.createdByUserId,
      enabledByUserId: autopublishRules.enabledByUserId,
    })
    .from(autopublishRules)
    .where(coveringDraft(companyId, draft))
    // The rule for the draft's own pillar before the one for any pillar.
    .orderBy(sql`${autopublishRules.pillar} = ''`)
    .limit(1)
    .for("share");
  if (!rule) {
    return null;
  }
  const owners = await lockActiveOwners(tx, companyId, [rule.createdByUserId, rule.enabledByUserId ?? ""]);
  const ownersActive = owners.has(rule.createdByUserId) && rule.enabledByUserId !== null && owners.has(rule.enabledByUserId);
  return { id: rule.id, enabled: true, platform: rule.platform, pillar: rule.pillar, ownersActive };
}

// An enabled rule of the company for the draft's platform, and its pillar or any.
function coveringDraft(companyId: string, draft: { platform: SocialPlatform; pillar: string }) {
  return and(
    eq(autopublishRules.companyId, companyId),
    eq(autopublishRules.platform, draft.platform),
    eq(autopublishRules.enabled, true),
    or(eq(autopublishRules.pillar, ""), eq(autopublishRules.pillar, draft.pillar)),
  );
}

// Which of these people are active, confirmed owners of the company, their
// rows locked FOR SHARE (a demotion or removal saved at that moment is
// waited for, then seen).
async function lockActiveOwners(tx: DbTransaction, companyId: string, userIds: string[]): Promise<Set<string>> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        inArray(users.id, userIds),
        eq(users.role, "owner"),
        eq(users.emailVerified, true),
        isNull(users.deactivatedAt),
      ),
    )
    .for("share");
  return new Set(rows.map((row) => row.id));
}
