import "server-only";
import { recordKnowledgeLookup } from "@/db/knowledge-lookups";
import { searchKnowledge } from "@/db/knowledge-search";
import { findPhoneLineByVapiNumberId } from "@/db/phone-lines";
import { buildCallAnswer, CALL_ANSWER_MAX_HITS } from "@/lib/knowledge/call-answer";
import { KNOWLEDGE_QUESTION_MAX_LENGTH } from "@/lib/knowledge/limits";
import {
  KNOWLEDGE_TOOL_NAME,
  knowledgeToolArgumentsSchema,
  vapiToolCallSchema,
  vapiToolCallsMessageSchema,
  type VapiToolCall,
  type VapiToolCallsMessage,
} from "@/lib/validation/vapi-tool-calls";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The voice assistant's tools during a live call (step 35):
// search_company_knowledge searches the company's approved support articles.
// services/vapi-webhook.ts hands over a tool-calls message only after its
// size, signature and per-IP limit checks, and answers 200 with what this
// returns, whatever happened: Vapi ignores every other status.
//
// LOGGING RULE for this file: a tool call holds what the caller asked, and
// the message the live transcript. Never log the query, the answer, any part
// of the message, or an error message. Fixed strings and class names only.

// One entry of the answer: a result or an error, never both, each one line.
export type ToolCallResult =
  | { name: string; toolCallId: string; result: string }
  | { name: string; toolCallId: string; error: string };

export type ToolCallsAnswer = { results: ToolCallResult[] };

// What the assistant is told when there is no answer for it.
export const TOOL_CALL_ERRORS = {
  notSetUp: "This phone number is not set up.",
  unknownTool: "Unknown tool.",
  badArguments: `Send the caller's question as "query": text of 1 to ${KNOWLEDGE_QUESTION_MAX_LENGTH} characters.`,
  rateLimited: "Too many knowledge searches right now. Offer to pass the question to the team as a ticket.",
  failed: "The knowledge base could not be searched right now. Offer to pass the question to the team as a ticket.",
} as const;

// Answers one signed tool-calls message: one entry per tool call that has an
// id to answer to. Never throws.
export async function answerVapiToolCalls(payload: unknown): Promise<ToolCallsAnswer> {
  const parsed = vapiToolCallsMessageSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn("Vapi tool call rejected: invalid tool-calls message");
    return { results: [] };
  }
  const toolCalls = readToolCalls(parsed.data.message.toolCallList);
  try {
    return { results: await answerToolCalls(parsed.data.message, toolCalls) };
  } catch (error) {
    // Finding the phone line failed: nothing was searched or recorded.
    console.error(`Vapi tool call failed: ${errorClassName(error)}`);
    return { results: toolCalls.map((toolCall) => errorFor(toolCall, TOOL_CALL_ERRORS.failed)) };
  }
}

// The entries that can be answered: an id, and a function with a name.
function readToolCalls(entries: unknown[]): VapiToolCall[] {
  const toolCalls: VapiToolCall[] = [];
  for (const entry of entries) {
    const toolCall = vapiToolCallSchema.safeParse(entry);
    if (toolCall.success) {
      toolCalls.push(toolCall.data);
    }
  }
  return toolCalls;
}

// Answers each tool call for the company that owns the phone line, the only
// thing that decides the company.
async function answerToolCalls(message: VapiToolCallsMessage, toolCalls: VapiToolCall[]): Promise<ToolCallResult[]> {
  const phoneNumberId = message.call?.phoneNumberId;
  const line = phoneNumberId ? await findPhoneLineByVapiNumberId(phoneNumberId) : undefined;
  if (!line) {
    console.warn("Vapi tool call ignored: unknown phone line");
    return toolCalls.map((toolCall) => errorFor(toolCall, TOOL_CALL_ERRORS.notSetUp));
  }
  const results: ToolCallResult[] = [];
  for (const toolCall of toolCalls) {
    results.push(await answerOneToolCallOrFail(line.companyId, message.call?.id ?? null, toolCall));
  }
  // Once per message, however many of its tool calls the limit refused.
  if (results.some((result) => "error" in result && result.error === TOOL_CALL_ERRORS.rateLimited)) {
    console.warn("Vapi tool call refused: rate limited");
  }
  return results;
}

// Answers one tool call; a failure (the database, most likely) answers
// "could not be searched" and logs the error's class only. WHY each on its
// own: an answer is given only once its lookup is recorded, so the call page
// lists exactly what the assistant got, also when a later tool call fails.
async function answerOneToolCallOrFail(companyId: string, vapiCallId: string | null, toolCall: VapiToolCall): Promise<ToolCallResult> {
  try {
    return await answerOneToolCall(companyId, vapiCallId, toolCall);
  } catch (error) {
    console.error(`Vapi tool call failed: ${errorClassName(error)}`);
    return errorFor(toolCall, TOOL_CALL_ERRORS.failed);
  }
}

// Searches the company's approved support articles for one tool call, and
// records which articles the answer held under the call's Vapi id. Without
// that id (Vapi always sends one) the answer is still given, and nothing is
// recorded: there would be no call to show it on.
async function answerOneToolCall(companyId: string, vapiCallId: string | null, toolCall: VapiToolCall): Promise<ToolCallResult> {
  if (toolCall.function.name !== KNOWLEDGE_TOOL_NAME) {
    return errorFor(toolCall, TOOL_CALL_ERRORS.unknownTool);
  }
  const toolArguments = knowledgeToolArgumentsSchema.safeParse(toolCall.function.arguments);
  if (!toolArguments.success) {
    return errorFor(toolCall, TOOL_CALL_ERRORS.badArguments);
  }
  if (await isOverRateLimit("knowledge-lookups", companyId, RATE_LIMITS.knowledgeLookupsPerCompany)) {
    return errorFor(toolCall, TOOL_CALL_ERRORS.rateLimited);
  }
  const hits = await searchKnowledge(companyId, { query: toolArguments.data.query, audience: "support", limit: CALL_ANSWER_MAX_HITS });
  const answer = buildCallAnswer(hits);
  if (vapiCallId) {
    await recordKnowledgeLookup(companyId, { vapiCallId, articleIds: answer.articleIds, hitCount: answer.hitCount });
  }
  return { name: toolCall.function.name, toolCallId: toolCall.id, result: answer.text };
}

// The answer entry that tells the assistant why there is no result.
function errorFor(toolCall: VapiToolCall, error: string): ToolCallResult {
  return { name: toolCall.function.name, toolCallId: toolCall.id, error };
}

// The error's class ("DrizzleQueryError"), never its message: a database
// error's message holds the query's values.
function errorClassName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "unknown";
}
