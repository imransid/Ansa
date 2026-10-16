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
import { companies } from "./companies";

// pending -> analyzing -> decided. See services/call-analysis.ts.
export const callAnalysisStatuses = ["pending", "analyzing", "decided"] as const;
export const callAnalysisStatusEnum = pgEnum("call_analysis_status", callAnalysisStatuses);
export type CallAnalysisStatus = (typeof callAnalysisStatuses)[number];

export const callOutcomes = ["solved", "needs_human"] as const;
export const callOutcomeEnum = pgEnum("call_outcome", callOutcomes);
export type CallOutcome = (typeof callOutcomes)[number];

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
    // Claude's short description of the customer's issue and its explanation.
    // Derived from the transcript, so encrypted the same way.
    aiIssueEncrypted: text("ai_issue_encrypted"),
    aiExplanationEncrypted: text("ai_explanation_encrypted"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
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
    // Postgres refuses a call whose phone line belongs to another company.
    foreignKey({
      name: "calls_phone_line_in_same_company_fk",
      columns: [table.companyId, table.phoneLineId],
      foreignColumns: [phoneLines.companyId, phoneLines.id],
    }),
    // A call is "decided" exactly when it has an outcome, source, reason and time.
    check(
      "calls_decision_fields_match_status",
      sql`(${table.analysisStatus} = 'decided') = (${table.aiOutcome} IS NOT NULL AND ${table.aiDecisionSource} IS NOT NULL AND ${table.aiReasonCode} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
    ),
  ],
);
