import { z } from "zod";

// The Emails page's "Process again" and "Make a ticket anyway" buttons. Only a
// claim: the service acts only on an email of the session's company.
export const inboundEmailIdSchema = z.object({
  // Lowercase, the way Postgres stores it: the id names the encryption
  // context of the email's content, and the ticket page decrypts with the id
  // the database gives back.
  inboundEmailId: z.uuid().transform((id) => id.toLowerCase()),
});
