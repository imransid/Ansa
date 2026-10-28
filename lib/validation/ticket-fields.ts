import { z } from "zod";
import { toPlainSingleLine } from "@/lib/plain-text";
import {
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_PHONE_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_SUBJECT_MAX_LENGTH,
} from "@/lib/ticket-limits";
import { customerEmailSchema } from "./customer-email";

// The rules for a ticket's fields, shared by every way a ticket is made or
// changed: by the AI (calls, emails), typed in by a person, or edited on the
// ticket page (step 31). One definition, so the limits are the same everywhere.

// Optional text: missing or blank becomes null, so the database never stores "".
export function optionalText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .nullish()
    .transform((value) => (value ? value : null));
}

// Text from a box with several lines. A submitted form turns each line break
// into \r\n, but the box's maxLength counted it as one character: count as
// the box did, and store \n.
export function multilineText() {
  return z.string().transform((text) => text.replace(/\r\n?/g, "\n"));
}

// One plain line (lib/plain-text.ts): a subject is shown in lists and in the
// assignment email's subject line, so no line breaks or invisible format
// characters, whoever wrote it.
export const ticketSubjectSchema = z
  .string()
  .transform(toPlainSingleLine)
  .pipe(
    z
      .string()
      .min(1, "Subject is required")
      .max(TICKET_SUBJECT_MAX_LENGTH, `A subject can be at most ${TICKET_SUBJECT_MAX_LENGTH} characters.`),
  );

export const ticketDescriptionSchema = multilineText().pipe(
  z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(TICKET_DESCRIPTION_MAX_LENGTH, `A description can be at most ${TICKET_DESCRIPTION_MAX_LENGTH} characters.`),
);

// One plain line too; blank becomes null (no name known).
export const customerNameSchema = z
  .string()
  .nullish()
  .transform((name) => toPlainSingleLine(name ?? ""))
  .pipe(z.string().max(CUSTOMER_NAME_MAX_LENGTH, `A name can be at most ${CUSTOMER_NAME_MAX_LENGTH} characters.`))
  .transform((name) => (name ? name : null));

export const customerPhoneSchema = optionalText(CUSTOMER_PHONE_MAX_LENGTH);

// A customer's address (the looser customer check, see ./customer-email.ts),
// or null.
export const optionalCustomerEmailSchema = customerEmailSchema.nullish().transform((value) => value ?? null);

// A form's email box: blank means "no email"; anything else must be a valid
// customer address.
export const customerEmailFromFormSchema = z
  .string()
  .nullish()
  .transform((value) => (value?.trim() ? value : null))
  .pipe(customerEmailSchema.nullable());

// A category picked from a form's menu, by id. "" is the "No category" choice
// and becomes null. The id is only a claim: the ticket's own transaction reads
// it as one of the company's active categories, or saves no category
// (db/ticket-creation.ts).
export const categoryChoiceSchema = z
  .union([z.literal(""), z.uuid()])
  .nullish()
  .transform((value) => (value ? value : null));
