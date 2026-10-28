import { z } from "zod";
import { ticketChannels } from "@/db/schema";
import { TICKET_NOTE_MAX_LENGTH } from "@/lib/ticket-notes";
import { NO_CONTROL_CHARACTERS } from "./control-characters";
import { customerEmailSchema } from "./customer-email";
import {
  categoryChoiceSchema,
  customerEmailFromFormSchema,
  customerNameSchema,
  customerPhoneSchema,
  optionalCustomerEmailSchema,
  optionalText,
  ticketDescriptionSchema,
  ticketSubjectSchema,
} from "./ticket-fields";

// What the code that makes tickets (the AI's call and email processing, the
// seed script) provides for a new ticket. There is deliberately no companyId,
// ticketNumber or status here: those are decided by the server, never by the
// caller. The fields' rules are shared with the forms (./ticket-fields.ts).
export const newTicketSchema = z.object({
  subject: ticketSubjectSchema,
  description: ticketDescriptionSchema,
  channel: z.enum(ticketChannels),
  category: optionalText(100),
  customerName: customerNameSchema,
  customerEmail: optionalCustomerEmailSchema,
  customerPhone: customerPhoneSchema,
});

export type NewTicketInput = z.infer<typeof newTicketSchema>;

// A ticket a person types in on the "New ticket" page (step 31). Nothing here
// names a company, number, status, channel or assignee: the company comes
// from the session, the channel is "manual", and routing picks the assignee.
// A customer email is saved only once the form has shown it back and the
// person confirmed it ("Solved emails for this ticket will go to ...", the
// step 9 rule): customerEmailConfirmed is "yes" only after that.
export const manualTicketSchema = z
  .object({
    subject: ticketSubjectSchema,
    description: ticketDescriptionSchema,
    customerName: customerNameSchema,
    customerEmail: customerEmailFromFormSchema,
    customerPhone: customerPhoneSchema,
    categoryId: categoryChoiceSchema,
    customerEmailConfirmed: z
      .literal("yes")
      .nullish()
      .transform((value) => value === "yes"),
  })
  .refine((ticket) => ticket.customerEmail === null || ticket.customerEmailConfirmed, {
    path: ["customerEmail"],
    error: "Confirm the address before saving",
  });

export type ManualTicketInput = z.infer<typeof manualTicketSchema>;

// "Edit" on the ticket page (step 31): the subject and the customer's name,
// with the same rules as a new ticket. Anyone in the company may do this.
// originalSubject and originalCustomerName are what the editor showed when it
// opened, read with the same rules so the two compare like for like: only a
// field the person changed is saved (db/ticket-details.ts).
export const editTicketDetailsSchema = z.object({
  ticketId: z.uuid(),
  subject: ticketSubjectSchema,
  customerName: customerNameSchema,
  originalSubject: ticketSubjectSchema,
  originalCustomerName: customerNameSchema,
});

// Ticket numbers arrive as text (from the URL), so they are converted first.
// "abc", "0", "-1" and "1.5" are all rejected.
export const ticketNumberSchema = z.coerce.number().int().positive().max(2_147_483_647);

export const ticketIdSchema = z.object({
  ticketId: z.uuid(),
});

// "Mark as solved". confirmedCustomerEmail is the customer email the ticket
// page showed when the person solved ("" = it showed none); with an address,
// they confirmed "This emails x@y.com ...". It is only a claim: the solve's
// UPDATE requires the ticket to have exactly this address (db/ticket-solving.ts),
// so the "solved" email never goes to an address they didn't see, such as one
// a teammate added or changed a moment before.
export const solveTicketSchema = z.object({
  ticketId: z.uuid(),
  confirmedCustomerEmail: z
    .string()
    .max(320)
    .regex(NO_CONTROL_CHARACTERS)
    .transform((value) => (value === "" ? null : value)),
});

export const assignTicketSchema = z.object({
  ticketId: z.uuid(),
  // "" is the "Unassigned" choice in the form and becomes null.
  // Any other value is only a claim: db/ticket-updates.ts checks the person
  // really is in the ticket's company before saving.
  assigneeUserId: z
    .string()
    .trim()
    .max(100)
    .regex(NO_CONTROL_CHARACTERS, "Unknown person.")
    .transform((value) => (value === "" ? null : value)),
});

// Retry of a customer email. The page only sends confirmPossibleDuplicate
// ("yes") after asking "Send it again anyway?": the email was first tried 23 or
// more hours ago, and Resend no longer recognises a repeat after 24.
export const retryEmailSchema = z.object({
  emailId: z.uuid(),
  confirmPossibleDuplicate: z
    .literal("yes")
    .nullish()
    .transform((value) => value === "yes"),
});

export const setCustomerEmailSchema = z.object({
  ticketId: z.uuid(),
  customerEmail: customerEmailSchema,
  // The form only sends "yes" after showing the address back to the expert
  // ("Solved emails for this ticket will go to ... Correct?").
  confirmed: z.literal("yes", "Confirm the address before saving"),
});

// An internal note on a ticket (step 30). There is deliberately no author or
// company here: both come from the session. The ticket id is only a claim,
// checked inside the INSERT (db/ticket-activity.ts).
export const ticketNoteSchema = z.object({
  // Lowercase, the way Postgres stores it: the id names the note's encryption
  // context, and the page decrypts with the id the database gives back.
  ticketId: z.uuid().transform((id) => id.toLowerCase()),
  body: z
    .string()
    // A submitted form turns each line break into \r\n, but the box's
    // maxLength counted it as one character: count as the box did.
    .transform((text) => text.replace(/\r\n?/g, "\n"))
    .pipe(
      z
        .string()
        .trim()
        .min(1, "Write the note first.")
        .max(TICKET_NOTE_MAX_LENGTH, `A note can be at most ${TICKET_NOTE_MAX_LENGTH} characters.`),
    ),
});
