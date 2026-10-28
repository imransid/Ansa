import "server-only";
import { z } from "zod";
import { askClaudeForContentDraft } from "@/adapters/claude";
import { getContentDraftForCompany } from "@/db/content-drafts";
import { createContentDraft, saveRegeneratedDraft, type GeneratedDraft } from "@/db/content-draft-writes";
import { readContentDraftAnswer } from "@/lib/content-studio/draft-answer";
import { EDITABLE_STATUSES } from "@/lib/content-studio/draft-fields";
import { buildContentDraftJsonSchema } from "@/lib/content-studio/draft-json-schema";
import { buildContentDraftPrompt, CONTENT_DRAFT_SYSTEM_PROMPT } from "@/lib/content-studio/draft-prompt";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { findMissingPlanFacts } from "@/lib/marketing-plan/plan-readiness";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker, ModelResult } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import { draftVersionSchema, newDraftSchema } from "@/lib/validation/content-drafts";
import { describeDraftOutcome, type CreatedDraftResult } from "./content-draft-messages";
import { gatherDraftInputs, type DraftRequest } from "./content-generation-inputs";
import { getConfirmedFactsForSession } from "./marketing-plan-inputs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The AI's part of the content studio (step 38): a new draft written by
// Claude, and new text for a draft that exists (Regenerate). Anyone in the
// company. A text Claude couldn't write, or wrote in a shape we can't use,
// saves NOTHING: no new draft, and a regenerated one keeps its last content.
//
// LOGGING RULE for this file: never log the facts, the articles, the topic,
// the prompt, Claude's answer or any error message. Fixed strings and class
// names only.

type GenerationResult = { ok: true; generated: GeneratedDraft } | { ok: false; errors: FormErrors };

// Writes a new draft for the session's company with Claude, and saves it.
// askModel is only replaced by the checks.
export async function generateDraftForSession(
  session: SessionContext,
  input: unknown,
  askModel: ModelAsker = askClaudeForContentDraft,
): Promise<CreatedDraftResult> {
  const parsed = newDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const generation = await writeWithClaude(session, parsed.data, askModel);
  if (!generation.ok) {
    return generation;
  }
  const created = await createContentDraft(session.companyId, session.userId, { ...parsed.data, generated: generation.generated });
  return created.outcome === "created" ? { ok: true, draftId: created.draftId } : { ok: false, errors: { message: "You can't add drafts to this company." } };
}

// Writes new content for one of the session company's drafts with Claude,
// as its next version, when nobody changed it since the version the page
// showed. askModel is only replaced by the checks.
export async function regenerateDraftForSession(
  session: SessionContext,
  input: unknown,
  askModel: ModelAsker = askClaudeForContentDraft,
): Promise<FormResult> {
  const parsed = draftVersionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown draft. Reload the page and try again." } };
  }
  const draft = await getContentDraftForCompany(session.companyId, parsed.data.draftId);
  if (!draft) {
    return describeDraftOutcome("not-found");
  }
  // Both checked again where it is saved, locked; here so an archived draft,
  // or one changed since the page showed it, costs no Claude call (paid, and
  // one of the company's hourly drafts).
  if (!EDITABLE_STATUSES.includes(draft.status)) {
    return describeDraftOutcome("wrong-status");
  }
  if (draft.version !== parsed.data.version) {
    return { ok: false, errors: { message: "Someone changed this draft after you opened it, so the AI wasn't asked. Reload the page to see their change." } };
  }
  const request: DraftRequest = { platform: draft.platform, format: draft.format, topic: draft.topic, pillar: draft.pillar, campaign: draft.campaign };
  const generation = await writeWithClaude(session, request, askModel);
  if (!generation.ok) {
    return generation;
  }
  const outcome = await saveRegeneratedDraft(session.companyId, session.userId, { ...parsed.data, generated: generation.generated });
  if (outcome === "stale") {
    return { ok: false, errors: { message: "Someone changed this draft while the AI was writing, so the AI's text was not saved. Reload the page to see their change." } };
  }
  return describeDraftOutcome(outcome);
}

// Asks Claude for one draft of the session's company, after what a draft
// needs and the hourly limit; nothing is saved here.
async function writeWithClaude(session: SessionContext, request: DraftRequest, askModel: ModelAsker): Promise<GenerationResult> {
  const facts = await getConfirmedFactsForSession(session);
  const sentTopics = new Set(facts.map((fact) => fact.topic));
  // The same facts a plan can't do without: without them Claude could only guess.
  const missing = findMissingPlanFacts(sentTopics);
  if (missing.length > 0) {
    const labels = missing.map((fact) => fact.label).join(", ");
    return { ok: false, errors: { message: `The AI needs these facts confirmed first: ${labels}. Confirm or fill them in on the Profile page, or start a blank draft.` } };
  }
  // Per company: every draft is a paid Claude call.
  if (await isOverRateLimit("content-generations", session.companyId, RATE_LIMITS.contentGenerationsPerCompany)) {
    return { ok: false, errors: { message: "Your company asked the AI for a lot of drafts this hour. Wait a while and try again." } };
  }
  const inputs = await gatherDraftInputs(session.companyId, facts, request);
  const result = await askModel({
    systemPrompt: CONTENT_DRAFT_SYSTEM_PROMPT,
    prompt: buildContentDraftPrompt(inputs.prompt),
    jsonSchema: buildContentDraftJsonSchema(),
  });
  const failure = describeModelFailure(result);
  if (failure) {
    // One fixed line with the class: a revoked key (AuthenticationError) and
    // a wrong model name (NotFoundError) need different fixes.
    console.error(`Claude call failed: ${failure}`);
  }
  const content = readContentDraftAnswer(result, request, sentTopics);
  if (!content) {
    return { ok: false, errors: { message: describeNoDraft(result) } };
  }
  const { claims, ...fields } = content;
  return { ok: true, generated: { fields, claims, factsUsed: facts, knowledgeUsed: inputs.knowledgeUsed, planVersion: inputs.planVersion } };
}

// Why no text came back, in plain words: never a server setting or an
// error's text (the log line has the class).
function describeNoDraft(result: ModelResult): string {
  if (result.kind === "unavailable") {
    return "The AI isn't available right now, so nothing was written. Try again later, or write the draft yourself.";
  }
  if (result.kind === "ok") {
    return "The AI's text came back in a form that can't be used, so nothing was saved. Try again.";
  }
  return "The AI couldn't write the draft just now, so nothing was saved. Try again in a few minutes.";
}
