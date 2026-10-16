import { z } from "zod";

// These schemas are only used AFTER the webhook signature has been verified.
// z.object drops every field not listed here, so things we must not keep
// (recording URLs, costs, the assistant's settings) are thrown away on parse.

// Just enough to know which event this is.
export const vapiMessageTypeSchema = z.object({
  message: z.object({
    type: z.string().max(100),
  }),
});

const isoDateTime = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

// Vapi's end-of-call-report. Field paths follow Vapi's server events docs and
// Call object; confirm them against the first real call (see CLAUDE.md).
export const endOfCallReportSchema = z.object({
  message: z.object({
    type: z.literal("end-of-call-report"),
    endedReason: z.string().max(200).optional(),
    startedAt: isoDateTime.optional(),
    endedAt: isoDateTime.optional(),
    artifact: z
      .object({
        transcript: z.string().max(500_000).optional(),
      })
      .optional(),
    // Older Vapi payloads put the transcript here instead of under artifact.
    transcript: z.string().max(500_000).optional(),
    call: z.object({
      id: z.string().min(1).max(200),
      phoneNumberId: z.string().min(1).max(200),
      startedAt: isoDateTime.optional(),
      endedAt: isoDateTime.optional(),
      customer: z
        .object({
          number: z.string().max(40).optional(),
        })
        .optional(),
    }),
  }),
});

export type EndOfCallReport = z.infer<typeof endOfCallReportSchema>;

export const callIdSchema = z.uuid();
