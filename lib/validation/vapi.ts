import { z } from "zod";
import { ESCALATION_NOTE_MAX_LENGTH } from "@/lib/ticket-limits";
import { categoryChoiceSchema, multilineText } from "./ticket-fields";

// These schemas are only used AFTER the webhook signature has been verified.
// z.object drops every field not listed here, so things we must not keep
// (costs, the assistant's settings) are thrown away on parse.
// Recording URLs are read (step 14) only to copy the file into private
// storage right away; they are never stored or logged.

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
        recordingUrl: z.string().max(2000).optional(),
        // Newer Vapi payloads nest the recording here instead.
        recording: z
          .object({ mono: z.object({ combinedUrl: z.string().max(2000).optional() }).optional() })
          .optional(),
      })
      .optional(),
    // Older Vapi payloads put the recording URL here.
    recordingUrl: z.string().max(2000).optional(),
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

// Vapi's id for a phone number, as ansa's operator pastes it from the Vapi
// dashboard into pnpm link:phone-line (owners can't link numbers).
export const vapiPhoneNumberIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{3,100}$/, "Paste the phone number id from Vapi");

export const analyzeCallSchema = z.object({
  // Lowercase, the way Postgres stores it: the id names the encryption
  // context of what Claude writes about the call, and the call page decrypts
  // with the id the database gives back.
  callId: z.uuid().transform((id) => id.toLowerCase()),
});

// "Escalate to a ticket" on a call the AI marked solved (step 31). The call
// id is only a claim: the escalation's UPDATE checks it is this company's
// call, decided "solved" and not escalated yet (db/call-escalation.ts).
export const escalateCallSchema = z.object({
  callId: z.uuid(),
  categoryId: categoryChoiceSchema,
  note: multilineText().pipe(
    z
      .string()
      .trim()
      .max(ESCALATION_NOTE_MAX_LENGTH, `A note can be at most ${ESCALATION_NOTE_MAX_LENGTH} characters.`)
      .transform((note) => (note ? note : null)),
  ),
});
