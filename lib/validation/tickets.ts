import { z } from "zod";
import { ticketChannels } from "@/db/schema";
import { emailSchema } from "./auth";

// Optional text: missing or blank becomes null, so the database never stores "".
function optionalText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .nullish()
    .transform((value) => (value ? value : null));
}

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Customer email is not a valid email address"))
  .nullish()
  .transform((value) => value ?? null);

// What any caller (seed script now, the AI in step 7) may provide for a new ticket.
// There is deliberately no companyId, ticketNumber or status here:
// those are decided by the server, never by the caller.
export const newTicketSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  description: z.string().trim().min(1, "Description is required").max(10_000),
  channel: z.enum(ticketChannels),
  category: optionalText(100),
  customerName: optionalText(200),
  customerEmail: optionalEmail,
  // 40 matches the longest caller number the Vapi webhook accepts.
  customerPhone: optionalText(40),
});

export type NewTicketInput = z.infer<typeof newTicketSchema>;

// Ticket numbers arrive as text (from the URL), so they are converted first.
// "abc", "0", "-1" and "1.5" are all rejected.
export const ticketNumberSchema = z.coerce.number().int().positive().max(2_147_483_647);

export const ticketIdSchema = z.object({
  ticketId: z.uuid(),
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
    .transform((value) => (value === "" ? null : value)),
});

export const ticketEmailIdSchema = z.object({
  emailId: z.uuid(),
});

export const setCustomerEmailSchema = z.object({
  ticketId: z.uuid(),
  customerEmail: emailSchema,
  // The form only sends "yes" after showing the address back to the expert
  // ("Solved emails for this ticket will go to ... Correct?").
  confirmed: z.literal("yes", "Confirm the address before saving"),
});
