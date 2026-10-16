import { z } from "zod";
import { ticketChannels } from "@/db/schema";

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
  customerPhone: optionalText(32),
});

export type NewTicketInput = z.infer<typeof newTicketSchema>;
