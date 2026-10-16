import { z } from "zod";
import { emailSchema } from "./auth";

export const replyToEmailSchema = z.object({
  // "" clears it.
  replyToEmail: z.union([z.literal(""), emailSchema]).transform((value) => (value === "" ? null : value)),
});

export const phoneLineSchema = z.object({
  // Vapi's phone number id, as shown in the Vapi dashboard.
  vapiPhoneNumberId: z.string().trim().regex(/^[A-Za-z0-9_-]{3,100}$/, "Paste the phone number id from Vapi"),
});

export const inboundAddressSchema = z.object({
  address: emailSchema,
});

export const documentIdSchema = z.object({
  documentId: z.uuid(),
});
