// Shared pieces for the content studio checks (step 38): a draft as Claude
// writes it, making drafts the way the studio's forms do (with a stand-in
// for Claude), editing and approving them as their page does, and what the
// database holds.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentDrafts } from "@/db/schema";
import { formatHashtags } from "@/lib/content-studio/hashtags";
import type { ModelResult } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import { editDraftForSession } from "@/services/content-draft-edits";
import { createBlankDraftForSession } from "@/services/content-drafts";
import { generateDraftForSession, regenerateDraftForSession } from "@/services/content-generation";
import { approveDraftForSession } from "@/services/content-review";
import { messageOf, modelAnswer, scriptedModel } from "./cofounder-helpers";
import { makeReadyForPlan } from "./marketing-plan-helpers";

// What "New draft" sends for a LinkedIn text post.
export const LINKEDIN_POST = { platform: "linkedin", format: "post", topic: "Our new weekday lunch menu", pillar: "", campaign: "" };

// A draft as Claude writes it for a LinkedIn post: one claim backed by the
// description fact, one by nothing. `overrides` replaces whole fields.
export function draftAnswerJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "",
    body: "Fresh sourdough every morning, baked in Lisbon.\n\nCome by for lunch this week.",
    hashtags: ["sourdough", "#Lisbon"],
    call_to_action: "Stop by the counter at lunchtime.",
    image_prompt: "",
    video_script: "",
    claims: [
      { text: "The bakery bakes sourdough bread in Lisbon.", fact_topics: ["description"] },
      { text: "Lunch is served every weekday.", fact_topics: [] },
    ],
    ...overrides,
  };
}

// A Claude answer holding that draft.
export function draftAnswer(overrides: Record<string, unknown> = {}): ModelResult {
  return modelAnswer(draftAnswerJson(overrides));
}

// Confirms what the AI needs before it writes a draft (the same as a plan).
export async function makeReadyForDrafts(owner: SessionContext): Promise<void> {
  await makeReadyForPlan(owner);
}

// Writes a new draft as the "New draft" form does, with a stand-in for
// Claude, and returns what came back and what was asked.
export async function generateDraft(session: SessionContext, request: Record<string, unknown> = LINKEDIN_POST, answer: ModelResult = draftAnswer()) {
  const model = scriptedModel([answer]);
  const result = await generateDraftForSession(session, request, model.ask);
  return { result, model };
}

// A draft the AI wrote, which must work: its id.
export async function generatedDraftId(session: SessionContext, request: Record<string, unknown> = LINKEDIN_POST, answer: ModelResult = draftAnswer()): Promise<string> {
  const { result } = await generateDraft(session, request, answer);
  assert.ok(result.ok, `no draft: ${messageOf(result)}`);
  return result.draftId;
}

// A blank draft ("Start blank"), which must work: its id.
export async function blankDraftId(session: SessionContext, request: Record<string, unknown> = LINKEDIN_POST): Promise<string> {
  const result = await createBlankDraftForSession(session, request);
  assert.ok(result.ok, `no draft: ${messageOf(result)}`);
  return result.draftId;
}

// One draft's row as the database holds it.
export async function draftRow(draftId: string) {
  const [row] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId));
  assert.ok(row, "the draft is not in the database");
  return row;
}

// What the editor sends for a draft as stored now, with `changes` typed in.
export async function editorForm(draftId: string, changes: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const row = await draftRow(draftId);
  return {
    draftId,
    version: String(row.version),
    topic: row.topic,
    pillar: row.pillar,
    campaign: row.campaign,
    title: row.title,
    body: row.body,
    hashtags: formatHashtags(row.hashtags),
    callToAction: row.callToAction,
    imagePrompt: row.imagePrompt,
    videoScript: row.videoScript,
    ...changes,
  };
}

// Saves an edit as the editor does, from the draft as stored now.
export async function editDraft(session: SessionContext, draftId: string, changes: Record<string, unknown>) {
  return editDraftForSession(session, await editorForm(draftId, changes));
}

// Regenerates as the draft's page does, at its version now, with a stand-in for Claude.
export async function regenerateDraft(session: SessionContext, draftId: string, answer: ModelResult = draftAnswer()) {
  const model = scriptedModel([answer]);
  const result = await regenerateDraftForSession(session, { draftId, version: String((await draftRow(draftId)).version) }, model.ask);
  return { result, model };
}

// Approves as the draft's page does, at its version now.
export async function approveDraft(session: SessionContext, draftId: string, claimsChecked: boolean) {
  const version = String((await draftRow(draftId)).version);
  return approveDraftForSession(session, { draftId, version, claimsChecked: claimsChecked ? "on" : null });
}
