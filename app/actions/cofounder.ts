"use server";

import { revalidatePath } from "next/cache";
import {
  answerInterviewThroughCore,
  confirmFactThroughCore,
  dismissProposalThroughCore,
  saveFactThroughCore,
  startOverInterviewThroughCore,
  suggestFactsThroughCore,
} from "@/lib/core-views/cofounder-profile";
import type { FormErrors, FormResult, SaveState } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { FactSuggestionResult } from "@/lib/types/fact-suggestions";
import type { InterviewAnswerResult } from "@/lib/types/onboarding-interview";

// Server actions are public POST endpoints. Keep them thin: read the form, ask
// core (which checks company, role, input and rate limits), refresh the
// Co-Founder's pages.

// What the answer box shows after an answer: what became of it, or why not.
export type InterviewAnswerState = { result?: InterviewAnswerResult };

// What "Suggest facts from knowledge" shows after it ran.
export type FactSuggestionState = { result?: FactSuggestionResult };

export async function answerInterviewAction(_previous: InterviewAnswerState | undefined, formData: FormData): Promise<InterviewAnswerState> {
  await requireSessionContext();
  // openingTopic is only in the form while the page shows the first question.
  const input = { answer: formData.get("answer"), openingTopic: formData.get("openingTopic") ?? undefined };
  const result = await answerInterviewThroughCore(input);
  // Also after a refusal: the answer may be saved without its reply.
  refreshCoFounderPages();
  return { result };
}

// "Start over" sends nothing: it acts on the session's own company.
export async function startOverInterviewAction(): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return refreshOrReturnErrors(await startOverInterviewThroughCore());
}

// Confirm sends no value (the proposal as shown is confirmed); Edit and
// confirm sends the owner's text. Both send the fact the page showed beside it.
export async function confirmFactAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = {
    topic: formData.get("topic"),
    shownProposal: formData.get("shownProposal"),
    shownConfirmedValue: formData.get("shownConfirmedValue"),
    value: formData.get("value") ?? undefined,
  };
  return refreshOrReturnErrors(await confirmFactThroughCore(input));
}

export async function dismissProposalAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = { topic: formData.get("topic"), shownProposal: formData.get("shownProposal") };
  return refreshOrReturnErrors(await dismissProposalThroughCore(input));
}

export async function saveFactAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const input = { topic: formData.get("topic"), value: formData.get("value"), originalValue: formData.get("originalValue") };
  const errors = refreshOrReturnErrors(await saveFactThroughCore(input));
  return errors ? { errors } : { saved: true };
}

export async function suggestFactsAction(_previous: FactSuggestionState | undefined, formData: FormData): Promise<FactSuggestionState> {
  await requireSessionContext();
  const articleId = formData.get("articleId");
  const result = await suggestFactsThroughCore(articleId);
  if (result.ok) {
    refreshCoFounderPages();
  }
  return { result };
}

function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  refreshCoFounderPages();
  return undefined;
}

function refreshCoFounderPages(): void {
  revalidatePath("/cofounder");
  revalidatePath("/cofounder/interview");
  revalidatePath("/cofounder/profile");
}
