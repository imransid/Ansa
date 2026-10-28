import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// pending -> analyzing -> decided. See services/call-analysis.ts.
export const callAnalysisStatuses = ["pending", "analyzing", "decided"] as const;
export const callAnalysisStatusEnum = pgEnum("call_analysis_status", callAnalysisStatuses);
export type CallAnalysisStatus = (typeof callAnalysisStatuses)[number];

export const callOutcomes = ["solved", "needs_human"] as const;
export const callOutcomeEnum = pgEnum("call_outcome", callOutcomes);
export type CallOutcome = (typeof callOutcomes)[number];

// none = Vapi sent no usable recording; stored = copied into private storage;
// failed = the copy didn't work (the Vapi link is not kept, so no retry).
export const recordingStatuses = ["none", "stored", "failed"] as const;
export const recordingStatusEnum = pgEnum("call_recording_status", recordingStatuses);
export type RecordingStatus = (typeof recordingStatuses)[number];

// "model" = Claude was asked. "rule" = our code decided without asking
// (no transcript, abnormal end, no API key, ...). Rules only ever escalate.
export const decisionSources = ["model", "rule"] as const;
export const decisionSourceEnum = pgEnum("call_decision_source", decisionSources);
export type DecisionSource = (typeof decisionSources)[number];

// A phone number a company's customers call, as known to Vapi.
// This mapping is the ONLY thing that decides which company a call belongs
// to: nothing in the webhook payload is trusted for that.
export const phoneLines = pgTable(
  "phone_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Vapi's id for the number (message.call.phoneNumberId). One number belongs
    // to exactly one company.
    vapiPhoneNumberId: text("vapi_phone_number_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Lets calls use a (company_id, phone_line_id) foreign key.
  (table) => [unique("phone_lines_company_id_id_unique").on(table.companyId, table.id)],
);

// One finished phone call, saved from Vapi's end-of-call-report.
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    phoneLineId: uuid("phone_line_id").notNull(),
    // Vapi's call id. Unique, so Vapi sending the same report twice saves it once.
    vapiCallId: text("vapi_call_id").notNull().unique(),
    // The customer's number, if not withheld. Shown in the app, never logged.
    callerNumber: text("caller_number"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    // Encrypted with lib/encryption.ts (AES-256-GCM). Never stored or logged in plain text.
    transcriptEncrypted: text("transcript_encrypted"),

    // The call's recording in PRIVATE storage (step 14), reached only through
    // short-lived signed links. The Vapi download link itself is never stored.
    recordingStatus: recordingStatusEnum("recording_status").notNull().default("none"),
    recordingKey: text("recording_key"),
    recordingContentType: text("recording_content_type"),

    // The call brain's decision (step 7).
    analysisStatus: callAnalysisStatusEnum("analysis_status").notNull().default("pending"),
    // When the current analysis started. A stuck "analyzing" call can be retried after a while.
    analysisStartedAt: timestamp("analysis_started_at", { withTimezone: true }),
    aiOutcome: callOutcomeEnum("ai_outcome"),
    aiDecisionSource: decisionSourceEnum("ai_decision_source"),
    // Why, as a fixed code from lib/call-brain/decision.ts (never model text).
    aiReasonCode: text("ai_reason_code"),
    // Which Claude model was asked, if any.
    aiModel: text("ai_model"),
    // When asking Claude failed (reason "model_error"): the SDK error's class
    // name, like "AuthenticationError", so the call page can say why (step 27).
    // Never an error message (the check below allows a name only).
    aiErrorClass: text("ai_error_class"),
    // Claude's short description of the customer's issue and its explanation.
    // Derived from the transcript, so encrypted the same way.
    aiIssueEncrypted: text("ai_issue_encrypted"),
    aiExplanationEncrypted: text("ai_explanation_encrypted"),
    // The proof behind a "solved" (step 31): the customer's own sentence that
    // confirmed it, as the transcript has it, so whoever reviews the call can
    // judge the verdict. Encrypted like the transcript it comes from.
    aiEvidenceEncrypted: text("ai_evidence_encrypted"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // Who escalated a call the AI marked "solved" to a ticket, and when (step
    // 31). ai_outcome and ai_reason_code keep what the AI decided, so its
    // accuracy can still be measured: solved calls a person escalated.
    escalatedByUserId: text("escalated_by_user_id"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("calls_company_id_created_at_idx").on(table.companyId, table.createdAt),
    // Lets tickets use a (company_id, call_id) foreign key.
    unique("calls_company_id_id_unique").on(table.companyId, table.id),
    // Postgres refuses a call whose phone line belongs to another company.
    foreignKey({
      name: "calls_phone_line_in_same_company_fk",
      columns: [table.companyId, table.phoneLineId],
      foreignColumns: [phoneLines.companyId, phoneLines.id],
    }),
    // Postgres doesn't index the calls side of that foreign key by itself:
    // without this, unlinking a number reads every call of the company to
    // check it has none. Setup also reads each number's newest call through it.
    index("calls_company_id_phone_line_id_created_at_idx").on(table.companyId, table.phoneLineId, table.createdAt),
    // A recording is "stored" exactly when we know where it is.
    check(
      "calls_recording_fields_match_status",
      sql`(${table.recordingStatus} = 'stored') = (${table.recordingKey} IS NOT NULL AND ${table.recordingContentType} IS NOT NULL)`,
    ),
    // A call is "decided" exactly when it has an outcome, source, reason and time.
    check(
      "calls_decision_fields_match_status",
      sql`(${table.analysisStatus} = 'decided') = (${table.aiOutcome} IS NOT NULL AND ${table.aiDecisionSource} IS NOT NULL AND ${table.aiReasonCode} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
    ),
    // A class name like "AuthenticationError" and nothing else: an error
    // message could quote Claude's answer or the transcript.
    check("calls_ai_error_class_is_a_name", sql`${table.aiErrorClass} IS NULL OR ${table.aiErrorClass} ~ '^[A-Za-z0-9_]{1,64}$'`),
    // The customer's confirming sentence exists only on a call decided "solved".
    check("calls_ai_evidence_only_when_solved", sql`${table.aiEvidenceEncrypted} IS NULL OR ${table.aiOutcome} = 'solved'`),
    // Postgres refuses an escalation by someone from another company.
    foreignKey({
      name: "calls_escalator_in_same_company_fk",
      columns: [table.companyId, table.escalatedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // Who and when are filled in together, and only on a call the AI decided
    // "solved": a "needs_human" call got its ticket with the decision.
    check("calls_escalation_fields_together", sql`(${table.escalatedByUserId} IS NULL) = (${table.escalatedAt} IS NULL)`),
    check(
      "calls_escalated_only_when_ai_solved",
      sql`${table.escalatedAt} IS NULL OR (${table.analysisStatus} = 'decided' AND ${table.aiOutcome} = 'solved')`,
    ),
    // The scheduled job looks for unfinished analyses of every company
    // (db/stuck-work.ts); there are only ever a few of those.
    index("calls_unfinished_analysis_idx")
      .on(table.createdAt)
      .where(sql`${table.analysisStatus} in ('pending', 'analyzing')`),
  ],
);
