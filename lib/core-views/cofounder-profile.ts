import "server-only";
import { callCore } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import { asFormResult } from "@/lib/core-views/ticket-actions";
import type { FormResult } from "@/lib/form-result";
import type { BusinessProfile, ProfileTopic } from "@/lib/types/business-profile";
import type { FactSuggestionResult } from "@/lib/types/fact-suggestions";
import type { Interview, InterviewAnswerResult } from "@/lib/types/onboarding-interview";
import type { InterviewMessage } from "@/lib/types/onboarding-turn";

// The Co-Founder's business profile and interview through the new backend
// (core's /api/v1/cofounder/profile and /interview), in the shapes the
// pages and their actions already read. Core checks the person (owners
// change, members read), the input and the limits.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type ArticleChoice = { id: string; title: string };

// Dates come as ISO text.
type CoreConfirmed = Omit<NonNullable<ProfileTopic["confirmed"]>, "at"> & { at: string };
type CoreProposal = Omit<NonNullable<ProfileTopic["proposal"]>, "at"> & { at: string };
type CoreTopic = Omit<ProfileTopic, "confirmed" | "proposal"> & { confirmed: CoreConfirmed | null; proposal: CoreProposal | null };
type CoreGroup = Omit<BusinessProfile["groups"][number], "topics"> & { topics: CoreTopic[] };
type CoreProfile = Omit<BusinessProfile, "groups"> & { groups: CoreGroup[] };
type CoreMessage = Omit<InterviewMessage, "createdAt"> & { createdAt: string };

// What an answer or a suggestion brought, as core answers it.
type AnswerOutcome = Omit<Extract<InterviewAnswerResult, { ok: true }>, "ok">;
type SuggestionOutcome = Omit<Extract<FactSuggestionResult, { ok: true }>, "ok">;

function toProfileTopic(topic: CoreTopic): ProfileTopic {
  const { confirmed, proposal } = topic;
  return {
    topic: topic.topic,
    label: topic.label,
    isKey: topic.isKey,
    confirmed: confirmed ? { value: confirmed.value, source: confirmed.source, at: new Date(confirmed.at), byName: confirmed.byName } : null,
    proposal: proposal ? { value: proposal.value, source: proposal.source, at: new Date(proposal.at) } : null,
  };
}

function toInterviewMessage(message: CoreMessage): InterviewMessage {
  return {
    id: message.id,
    author: message.author,
    authorName: message.authorName,
    text: message.text,
    unreadable: message.unreadable,
    createdAt: new Date(message.createdAt),
  };
}

// The Profile page: every topic grouped, how complete it is, whether this
// person changes it (owners), and the approved articles "Suggest facts from
// knowledge" may read (sent to owners only).
export async function getProfilePageFromCore(): Promise<{ profile: BusinessProfile; isOwner: boolean; articles: ArticleChoice[] }> {
  const answer = await callCore<{ profile: CoreProfile; canManage: boolean; articlesForSuggestions: ArticleChoice[] | null }>("GET", "/api/v1/cofounder/profile");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { profile, canManage, articlesForSuggestions } = answer.data;
  return {
    profile: {
      groups: profile.groups.map((group) => ({ group: group.group, label: group.label, topics: group.topics.map(toProfileTopic) })),
      completion: profile.completion,
      missingKeyTopics: profile.missingKeyTopics ?? [],
    },
    isOwner: canManage,
    articles: (articlesForSuggestions ?? []).map((article) => ({ id: article.id, title: article.title })),
  };
}

// The Interview page: the newest messages (oldest first), the opening
// question while there is none, whether it is finished, and whether this
// person answers (owners).
export async function getInterviewFromCore(): Promise<{ interview: Interview; isOwner: boolean }> {
  const answer = await callCore<{ interview: Omit<Interview, "messages"> & { messages: CoreMessage[] }; canAnswer: boolean }>("GET", "/api/v1/cofounder/interview");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { interview, canAnswer } = answer.data;
  return {
    interview: {
      messages: interview.messages.map(toInterviewMessage),
      olderMessagesHidden: interview.olderMessagesHidden,
      opening: interview.opening,
      finished: interview.finished,
    },
    isOwner: canAnswer,
  };
}

// An owner's answer; core asks the AI for the facts it holds and the next
// question. openingTopic is in the form only while the page shows the first
// question: the topic it asked about, or "none".
export async function answerInterviewThroughCore(input: { answer: unknown; openingTopic: unknown }): Promise<InterviewAnswerResult> {
  const answer = await callCore<AnswerOutcome>("POST", "/api/v1/cofounder/interview/answer", {
    answer: text(input.answer),
    ...(typeof input.openingTopic === "string" ? { openingTopic: input.openingTopic } : {}),
  });
  if (!answer.ok) {
    return { ok: false, errors: toFormErrors(answer) };
  }
  return {
    ok: true,
    proposedTopics: answer.data.proposedTopics ?? [],
    aiReadAnswer: answer.data.aiReadAnswer,
    fixedQuestionTopic: answer.data.fixedQuestionTopic ?? null,
  };
}

// "Start over": deletes the conversation, never the facts.
export async function startOverInterviewThroughCore(): Promise<FormResult> {
  return asFormResult(await callCore("POST", "/api/v1/cofounder/interview/start-over"));
}

// Confirm (no value: the proposal as shown) or Edit and confirm (the
// owner's text), both naming the proposal and the fact the page showed.
export async function confirmFactThroughCore(input: { topic: unknown; shownProposal: unknown; shownConfirmedValue: unknown; value: unknown }): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/cofounder/profile/confirm", {
    topic: text(input.topic),
    shownProposal: text(input.shownProposal),
    shownConfirmedValue: text(input.shownConfirmedValue),
    ...(typeof input.value === "string" ? { value: input.value } : {}),
  });
  return asFormResult(answer);
}

// Dismiss: drops the proposal the page showed (the confirmed value stays).
export async function dismissProposalThroughCore(input: { topic: unknown; shownProposal: unknown }): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/cofounder/profile/dismiss", { topic: text(input.topic), shownProposal: text(input.shownProposal) });
  return asFormResult(answer);
}

// Edit or Fill in: the owner's own words, confirmed at once, while the fact
// is still the one the editor opened with.
export async function saveFactThroughCore(input: { topic: unknown; value: unknown; originalValue: unknown }): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/cofounder/profile/edit", {
    topic: text(input.topic),
    value: text(input.value),
    originalValue: text(input.originalValue),
  });
  return asFormResult(answer);
}

// "Suggest facts from knowledge": the AI reads one approved article and
// proposes facts (proposals only).
export async function suggestFactsThroughCore(articleId: unknown): Promise<FactSuggestionResult> {
  const answer = await callCore<SuggestionOutcome>("POST", "/api/v1/cofounder/profile/suggest", { articleId: text(articleId) });
  if (!answer.ok) {
    return { ok: false, errors: toFormErrors(answer) };
  }
  return { ok: true, proposedTopics: answer.data.proposedTopics ?? [], readWholeArticle: answer.data.readWholeArticle };
}
