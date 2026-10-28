import "server-only";
import { z } from "zod";
import { createAutopublishRule, setAutopublishRuleEnabled, type RuleChangeOutcome } from "@/db/autopublish-rules";
import { canManagePublishing } from "@/lib/cofounder/permissions";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { autopublishRuleIdSchema, newAutopublishRuleSchema } from "@/lib/validation/publishing";
import { readCurrentPlan } from "./content-generation-inputs";
import { ONLY_OWNERS_PUBLISH, tooManyPublishingChanges } from "./publish-messages";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Auto-publish rules (step 41, owners, on the queue page): a rule lets a
// platform's drafts of one content pillar (or any) be scheduled without an
// approval of their own, when they break no rule and make no claim an
// owner would have to check. A new rule is switched OFF; the page asks for
// an explicit confirm before switching one on, and nothing switches one on
// by itself. Every post under a rule is checked again when it runs.

// Makes a rule (switched off) for one platform and a pillar of the current
// marketing plan, or any pillar. Owners only.
export async function createAutopublishRuleForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = newAutopublishRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (!canManagePublishing(session.role)) {
    return ONLY_OWNERS_PUBLISH;
  }
  const { platform, pillar } = parsed.data;
  const plan = await readCurrentPlan(session.companyId);
  const planPillar = plan?.content.pillars.find((candidate) => candidate.name.trim().toLowerCase() === pillar.trim().toLowerCase());
  if (pillar !== "" && !planPillar) {
    return { ok: false, errors: { fieldErrors: { pillar: ["Pick a content pillar of the current marketing plan, or any pillar."] } } };
  }
  if (await isOverRateLimit("publishing-changes", session.userId, RATE_LIMITS.publishingChangesPerUser)) {
    return tooManyPublishingChanges();
  }
  const created = await createAutopublishRule(session.companyId, session.userId, { platform, pillar: planPillar?.name ?? "" });
  if (created.outcome === "not-allowed") {
    return ONLY_OWNERS_PUBLISH;
  }
  return created.outcome === "exists" ? { ok: false, errors: { message: "There is a rule for that platform and pillar already." } } : { ok: true };
}

// Switches one of the session company's rules on (after the page's
// confirm) or off. Owners only.
export async function setAutopublishRuleForSession(session: SessionContext, input: unknown, enabled: boolean): Promise<FormResult> {
  const parsed = autopublishRuleIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown rule. Reload the page and try again." } };
  }
  if (!canManagePublishing(session.role)) {
    return ONLY_OWNERS_PUBLISH;
  }
  if (await isOverRateLimit("publishing-changes", session.userId, RATE_LIMITS.publishingChangesPerUser)) {
    return tooManyPublishingChanges();
  }
  return describeRuleChange(await setAutopublishRuleEnabled(session.companyId, session.userId, parsed.data.ruleId, enabled));
}

function describeRuleChange(outcome: RuleChangeOutcome): FormResult {
  switch (outcome) {
    case "changed":
    case "unchanged":
      return { ok: true };
    case "not-found":
      return { ok: false, errors: { message: "We couldn't find that rule. Reload the page." } };
    case "not-allowed":
      return ONLY_OWNERS_PUBLISH;
  }
}
