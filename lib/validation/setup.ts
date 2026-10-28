import { z } from "zod";
import { companyNameSchema } from "./auth";
import { customerEmailSchema } from "./customer-email";

// The Setup page's company name (owners only).
export const companyNameSettingSchema = z.object({
  companyName: companyNameSchema,
});

// The company's own addresses are checked like customer addresses
// (./customer-email.ts): an international domain must work here too.
export const replyToEmailSchema = z.object({
  // "" clears it.
  replyToEmail: z.union([z.literal(""), customerEmailSchema]).transform((value) => (value === "" ? null : value)),
});

// An address the company's customers write to (display and loop detection only).
export const inboundAddressSchema = z.object({
  address: customerEmailSchema,
});

export const documentIdSchema = z.object({
  documentId: z.uuid(),
});
