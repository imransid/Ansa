import "server-only";
import { z } from "zod";
import {
  confirmBusinessFactProposal,
  dismissBusinessFactProposal,
  getBusinessFactsForCompany,
  saveBusinessFactValue,
  type BusinessFactRow,
  type FactChangeOutcome,
} from "@/db/business-facts";
import {
  BUSINESS_FACT_GROUP_LABELS,
  BUSINESS_FACT_TOPICS,
  businessFactGroups,
  businessFactTopics,
  isBusinessFactTopic,
  type BusinessFactGroup,
  type BusinessFactTopic,
  type FactConfirmationSource,
  type FactProposalSource,
} from "@/lib/business-facts";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { factStatus, measureProfileCompletion, type FactValuesByTopic, type ProfileCompletion } from "@/lib/cofounder/profile-status";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { confirmFactSchema, dismissProposalSchema, editFactSchema } from "@/lib/validation/cofounder";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The company's business profile (step 36): what the Co-Founder knows about
// the business, topic by topic. Members read it; only owners confirm,
// dismiss or edit (checked here for a clear message, and again in /db,
// locked, in the transaction that writes).

export type ProfileTopic = {
  topic: BusinessFactTopic;
  label: string;
  isKey: boolean;
  confirmed: { value: string; source: FactConfirmationSource; at: Date; byName: string | null } | null;
  proposal: { value: string; source: FactProposalSource; at: Date } | null;
};

export type BusinessProfile = {
  groups: { group: BusinessFactGroup; label: string; topics: ProfileTopic[] }[];
  completion: ProfileCompletion;
  // Key topics with neither a confirmed value nor a proposal, in the interview's order.
  missingKeyTopics: { topic: BusinessFactTopic; label: string }[];
};

const STALE_EDIT =
  "Someone changed this fact after you opened it, so your change was not saved. Copy your text, reload the page and make your change again.";

// Reads the session company's profile: every topic, grouped as the Profile
// page shows them, and how complete it is.
export async function getBusinessProfileForSession(session: SessionContext): Promise<BusinessProfile> {
  const rows = await getBusinessFactsForCompany(session.companyId);
  const topics = businessFactTopics.map((topic) => toProfileTopic(topic, rows.find((row) => row.topic === topic)));
  const values = toFactValues(rows);
  return {
    groups: businessFactGroups.map((group) => ({
      group,
      label: BUSINESS_FACT_GROUP_LABELS[group],
      topics: topics.filter((topic) => BUSINESS_FACT_TOPICS[topic.topic].group === group),
    })),
    completion: measureProfileCompletion(values),
    missingKeyTopics: topics
      .filter((topic) => topic.isKey && factStatus(values[topic.topic]) === "missing")
      .map((topic) => ({ topic: topic.topic, label: topic.label })),
  };
}

// The session company's confirmed values and proposals by topic, as the
// interview and the suggestions read them.
export async function getFactValuesForSession(session: SessionContext): Promise<FactValuesByTopic> {
  return toFactValues(await getBusinessFactsForCompany(session.companyId));
}

// Confirms a waiting proposal of the session's company as the page showed
// it, or as the owner edited it (Edit and confirm), while the fact beside it
// is still the one the page showed. Owners only.
export async function confirmFactForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = confirmFactSchema.safeParse(input);
  if (!parsed.success) {
    return fieldErrorsOrUnknown(parsed.error);
  }
  const refusal = await refuseUnlessOwnerWithinLimit(session);
  if (refusal) {
    return refusal;
  }
  const { topic, shownProposal, shownConfirmedValue, value } = parsed.data;
  const confirmation = { topic, shownProposal, shownConfirmedValue, value: value ?? shownProposal };
  const outcome = await confirmBusinessFactProposal(session.companyId, session.userId, confirmation);
  return describeOutcome(outcome, "This proposal, or the fact beside it, changed or was handled meanwhile, so nothing was confirmed. Reload the page to see it.");
}

// Dismisses a waiting proposal of the session's company. Owners only.
export async function dismissProposalForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = dismissProposalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown proposal." } };
  }
  const refusal = await refuseUnlessOwnerWithinLimit(session);
  if (refusal) {
    return refusal;
  }
  const outcome = await dismissBusinessFactProposal(session.companyId, session.userId, parsed.data);
  return describeOutcome(outcome, "This proposal changed or was handled meanwhile, so nothing was dismissed. Reload the page to see it.");
}

// Saves an owner's own value for one topic of the session's company,
// confirmed at once. Owners only.
export async function saveFactForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = editFactSchema.safeParse(input);
  if (!parsed.success) {
    return fieldErrorsOrUnknown(parsed.error);
  }
  const refusal = await refuseUnlessOwnerWithinLimit(session);
  if (refusal) {
    return refusal;
  }
  return describeOutcome(await saveBusinessFactValue(session.companyId, session.userId, parsed.data), STALE_EDIT);
}

// Owners only, and within the business-profile-changes limit ("Start over"
// counts against it too, services/onboarding-interview.ts). Null when the
// change may go ahead.
async function refuseUnlessOwnerWithinLimit(session: SessionContext): Promise<FormResult | null> {
  if (!canManageBusinessProfile(session.role)) {
    return { ok: false, errors: { message: "Only owners can change the business profile." } };
  }
  if (await isOverRateLimit("business-profile-changes", session.userId, RATE_LIMITS.businessProfileChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  return null;
}

function toFactValues(rows: BusinessFactRow[]): FactValuesByTopic {
  const values: FactValuesByTopic = {};
  for (const row of rows) {
    // A topic the code no longer lists is left out.
    if (isBusinessFactTopic(row.topic)) {
      values[row.topic] = { confirmedValue: row.confirmedValue, proposedValue: row.proposedValue };
    }
  }
  return values;
}

// Every field named: the page gets what it shows, nothing else.
function toProfileTopic(topic: BusinessFactTopic, row: BusinessFactRow | undefined): ProfileTopic {
  const info = BUSINESS_FACT_TOPICS[topic];
  const confirmed =
    row?.confirmedValue && row.confirmedSource && row.confirmedAt
      ? { value: row.confirmedValue, source: row.confirmedSource, at: row.confirmedAt, byName: row.confirmedByName }
      : null;
  const proposal =
    row?.proposedValue && row.proposedSource && row.proposedAt ? { value: row.proposedValue, source: row.proposedSource, at: row.proposedAt } : null;
  return { topic, label: info.label, isKey: info.isKey, confirmed, proposal };
}

function describeOutcome(outcome: FactChangeOutcome, staleMessage: string): FormResult {
  switch (outcome) {
    case "changed":
    case "unchanged":
      return { ok: true };
    case "not-allowed":
      return { ok: false, errors: { message: "Only owners can change the business profile." } };
    case "stale":
      return { ok: false, errors: { message: staleMessage } };
  }
}

// The value's problems go under the box; a bad topic or a changed form gets
// a plain message.
function fieldErrorsOrUnknown(error: z.ZodError): FormResult {
  const valueErrors = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  if (valueErrors.value) {
    return { ok: false, errors: { fieldErrors: { value: valueErrors.value } } };
  }
  return { ok: false, errors: { message: "Unknown topic or proposal. Reload the page and try again." } };
}
