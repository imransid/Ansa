import { z } from "zod";
import { knowledgeKinds } from "@/lib/knowledge/kinds";
import {
  KNOWLEDGE_BODY_MAX_LENGTH,
  KNOWLEDGE_QUESTION_MAX_LENGTH,
  KNOWLEDGE_SOURCE_URL_MAX_LENGTH,
  KNOWLEDGE_TITLE_MAX_LENGTH,
} from "@/lib/knowledge/limits";
import { toPlainSingleLine } from "@/lib/plain-text";
import { multilineText } from "./ticket-fields";

// What the knowledge forms send (step 34). There is deliberately no company,
// author, status or approver here: the company and the author come from the
// session, a new article is always a draft, and only the owner's own
// "Approve" approves it.

// One plain line (lib/plain-text.ts), like a ticket subject: titles show in
// lists, and later in what the AI quotes.
export const knowledgeTitleSchema = z
  .string()
  .transform(toPlainSingleLine)
  .pipe(
    z
      .string()
      .min(1, "Give the article a title.")
      .max(KNOWLEDGE_TITLE_MAX_LENGTH, `A title can be at most ${KNOWLEDGE_TITLE_MAX_LENGTH} characters.`),
  );

// Line breaks count once, as in the box, and are stored as \n. Tabs stay;
// other control characters can't be typed, and Postgres refuses NUL.
export const knowledgeBodySchema = multilineText().pipe(
  z
    .string()
    .trim()
    .min(1, "Write the article first.")
    .max(KNOWLEDGE_BODY_MAX_LENGTH, `An article can be at most ${KNOWLEDGE_BODY_MAX_LENGTH.toLocaleString("en-US")} characters.`)
    .regex(/^(?:[^\p{Cc}]|[\n\t])*$/u, "Remove the invisible control characters from the text."),
);

// A ticked checkbox sends "on"; an unticked one sends nothing.
const checkboxSchema = z
  .literal("on")
  .nullish()
  .transform((value) => value === "on");

export const knowledgeArticleSchema = z.object({
  title: knowledgeTitleSchema,
  kind: z.enum(knowledgeKinds, "Pick what kind of article this is."),
  body: knowledgeBodySchema,
  useForSupport: checkboxSchema,
  useForMarketing: checkboxSchema,
});

// Lowercase, the way Postgres gives ids back.
const articleIdSchema = z.uuid().transform((id) => id.toLowerCase());

// The revision the page showed (db/schema/knowledge.ts): only a claim, compared
// with the stored one inside the transaction that writes.
const revisionSchema = z.coerce.number().int().min(1).max(2_147_483_647);

export const editKnowledgeArticleSchema = knowledgeArticleSchema.extend({
  articleId: articleIdSchema,
  revision: revisionSchema,
});

export const knowledgeArticleIdSchema = z.object({ articleId: articleIdSchema });

export const approveKnowledgeArticleSchema = z.object({ articleId: articleIdSchema, revision: revisionSchema });

// "Test what the AI finds": what a customer might ask, on one line.
export const knowledgeQuestionSchema = z.object({
  question: z
    .string()
    .transform(toPlainSingleLine)
    .pipe(
      z
        .string()
        .min(1, "Type a question first.")
        .max(KNOWLEDGE_QUESTION_MAX_LENGTH, `A question can be at most ${KNOWLEDGE_QUESTION_MAX_LENGTH} characters.`),
    ),
});

// "Import a web page": an https address. lib/safe-fetch.ts checks the rest
// (host, port, every address it resolves to, every redirect).
export const webPageImportSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Paste the page's address.")
    .max(KNOWLEDGE_SOURCE_URL_MAX_LENGTH, `An address can be at most ${KNOWLEDGE_SOURCE_URL_MAX_LENGTH.toLocaleString("en-US")} characters.`)
    .refine(isHttpsUrl, "Use the page's full https:// address.")
    .transform((url) => new URL(url).toString())
    .pipe(z.string().max(KNOWLEDGE_SOURCE_URL_MAX_LENGTH, "That address is too long.")),
});

// "Add to knowledge" on a Setup document.
export const documentImportSchema = z.object({ documentId: z.uuid() });

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}
