// Checks that one company can never see another company's data, that callers
// cannot choose server-owned fields (company, role, ticket number), and that
// invite links only ever work as intended.
//
// Run with: pnpm check:tenant-isolation
// Needs the local database running and migrated (pnpm db:up && pnpm db:migrate).
// Refuses to run unless DATABASE_URL is local and real email, R2 storage and
// Stripe are off (tenant-isolation/local-only.ts).
// Creates throwaway companies, users, tickets (with notes and history, some
// typed in by hand), invites, emails, phone lines, support addresses, calls
// (some escalated to tickets, some with knowledge lookups), documents,
// knowledge articles, business facts, Co-Founder interviews, marketing
// plans, content drafts, media (images, videos and the requests that
// made them), social accounts (with their connection attempts), and posts
// in the publishing queue (with auto-publish rules and the activity log),
// their numbers and performance reviews, and one company that walks the
// whole way from signup to a checked review (step 43), and deletes them at
// the end.

import { db } from "@/db/client";
import { runAccountChecks } from "./tenant-isolation/account-checks";
import { runAnalyticsChecks } from "./tenant-isolation/analytics-checks";
import { runAssignmentChecks } from "./tenant-isolation/assignment-checks";
import { runAuthHandlerChecks } from "./tenant-isolation/auth-handler-checks";
import { runBacklogRoutingChecks } from "./tenant-isolation/backlog-routing-checks";
import { runBillingChecks } from "./tenant-isolation/billing-checks";
import { runBillingCompanyChecks } from "./tenant-isolation/billing-company-checks";
import { runBrainAnalysisChecks } from "./tenant-isolation/brain-analysis-checks";
import { runBrainEvidenceChecks } from "./tenant-isolation/brain-evidence-checks";
import { runBrainFailureChecks } from "./tenant-isolation/brain-failure-checks";
import { runBrainGuardChecks } from "./tenant-isolation/brain-guard-checks";
import { runCallEscalationChecks } from "./tenant-isolation/call-escalation-checks";
import { runCallListChecks } from "./tenant-isolation/call-list-checks";
import { runCallTicketChecks } from "./tenant-isolation/call-ticket-checks";
import { runCategoryChecks } from "./tenant-isolation/category-checks";
import { runCategoryLimitChecks } from "./tenant-isolation/category-limit-checks";
import { runCalendarPlanChecks } from "./tenant-isolation/calendar-plan-checks";
import { runClaudeAdapterCalendarChecks } from "./tenant-isolation/claude-adapter-calendar-checks";
import { runClaudeAdapterChecks } from "./tenant-isolation/claude-adapter-checks";
import { runClaudeAdapterDraftChecks } from "./tenant-isolation/claude-adapter-draft-checks";
import { runClaudeAdapterPlanChecks } from "./tenant-isolation/claude-adapter-plan-checks";
import { runClosingChecks } from "./tenant-isolation/closing-checks";
import { runCofounderChecks } from "./tenant-isolation/cofounder-checks";
import { runConcurrencyChecks } from "./tenant-isolation/concurrency-checks";
import { runContentStudioChecks } from "./tenant-isolation/content-studio-checks";
import { runControlCharacterChecks } from "./tenant-isolation/control-character-checks";
import { runCustomerEmailChecks } from "./tenant-isolation/customer-email-checks";
import { runCustomerEmailSafetyChecks } from "./tenant-isolation/customer-email-safety-checks";
import { runEmailChecks } from "./tenant-isolation/email-checks";
import { runEmailSliceChecks } from "./tenant-isolation/email-slice-checks";
import { runEmailsPageChecks } from "./tenant-isolation/emails-page-checks";
import { runFailureReportChecks } from "./tenant-isolation/failure-report-checks";
import { runFileFailureChecks } from "./tenant-isolation/file-failure-checks";
import { runFirstRunChecks } from "./tenant-isolation/first-run-checks";
import { cleanUpTestData } from "./tenant-isolation/cleanup";
import { runDocumentCapChecks } from "./tenant-isolation/document-cap-checks";
import { runForwardingChecks } from "./tenant-isolation/forwarding-checks";
import { runForwardingSetupChecks } from "./tenant-isolation/forwarding-setup-checks";
import { getFailureCount, signUpTestOwner } from "./tenant-isolation/helpers";
import { runHygieneChecks } from "./tenant-isolation/hygiene-checks";
import { runInboundContentChecks } from "./tenant-isolation/inbound-content-checks";
import { runInboundEmailChecks } from "./tenant-isolation/inbound-email-checks";
import { runInboundFilterChecks } from "./tenant-isolation/inbound-filter-checks";
import { runInboundRecoveryChecks } from "./tenant-isolation/inbound-recovery-checks";
import { runInviteChecks } from "./tenant-isolation/invite-checks";
import { runInviteLimitChecks } from "./tenant-isolation/invite-limit-checks";
import { runKnowledgeChecks, runKnowledgeIndexChecks } from "./tenant-isolation/knowledge-checks";
import { runKnowledgeFetchChecks } from "./tenant-isolation/knowledge-fetch-checks";
import { runKnowledgeImportChecks } from "./tenant-isolation/knowledge-import-checks";
import { runKnowledgePermissionChecks } from "./tenant-isolation/knowledge-permission-checks";
import { runKnowledgeRaceChecks } from "./tenant-isolation/knowledge-race-checks";
import { runKnowledgeTextChecks } from "./tenant-isolation/knowledge-text-checks";
import { runKnowledgeZipChecks } from "./tenant-isolation/knowledge-zip-checks";
import { runKnownDeviceChecks } from "./tenant-isolation/known-device-checks";
import { runLintGuardChecks } from "./tenant-isolation/lint-guard-checks";
import { findReasonNotToRunChecks } from "./tenant-isolation/local-only";
import { runLoginLimitChecks } from "./tenant-isolation/login-limit-checks";
import { runLoginRedirectChecks } from "./tenant-isolation/login-redirect-checks";
import { runManualTicketChecks } from "./tenant-isolation/manual-ticket-checks";
import { runMediaChecks } from "./tenant-isolation/media-checks";
import { runNotificationChecks } from "./tenant-isolation/notification-checks";
import { runOneProductChecks } from "./tenant-isolation/one-product-checks";
import { runOperatorScriptChecks } from "./tenant-isolation/operator-script-checks";
import { runOpsChecks } from "./tenant-isolation/ops-checks";
import { runOpsMaintenanceChecks } from "./tenant-isolation/ops-maintenance-checks";
import { runOpsReadinessChecks } from "./tenant-isolation/ops-readiness-checks";
import { runOutboxClaimChecks } from "./tenant-isolation/outbox-claim-checks";
import { runOwnerInviteChecks } from "./tenant-isolation/owner-invite-checks";
import { runPageHeadingChecks } from "./tenant-isolation/page-heading-checks";
import { runPaginationChecks } from "./tenant-isolation/pagination-checks";
import { runPublishingChecks } from "./tenant-isolation/publishing-checks";
import { runPasswordResetChecks } from "./tenant-isolation/password-reset-checks";
import { runRecordingChecks } from "./tenant-isolation/recording-checks";
import { runRemovalChecks } from "./tenant-isolation/removal-checks";
import { runRepeatCustomerChecks } from "./tenant-isolation/repeat-customer-checks";
import { runResendReceivingChecks } from "./tenant-isolation/resend-receiving-checks";
import { runRoutingChecks } from "./tenant-isolation/routing-checks";
import { runSenderAuthenticationChecks } from "./tenant-isolation/sender-authentication-checks";
import { runSetupChecks } from "./tenant-isolation/setup-checks";
import { runSignupChecks } from "./tenant-isolation/signup-checks";
import { runSocialChecks } from "./tenant-isolation/social-checks";
import { runStuckWorkChecks } from "./tenant-isolation/stuck-work-checks";
import { runTakeoverChecks } from "./tenant-isolation/takeover-checks";
import { runTeamChecks } from "./tenant-isolation/team-checks";
import { runTicketChangeChecks } from "./tenant-isolation/ticket-change-checks";
import { runTicketChecks } from "./tenant-isolation/ticket-checks";
import { runTicketDetailsChecks } from "./tenant-isolation/ticket-details-checks";
import { runTicketEligibilityChecks } from "./tenant-isolation/ticket-eligibility-checks";
import { runTicketEmailChecks } from "./tenant-isolation/ticket-email-checks";
import { runTicketHistoryChecks } from "./tenant-isolation/ticket-history-checks";
import { runTicketNoteChecks } from "./tenant-isolation/ticket-note-checks";
import { runTicketQueueChecks } from "./tenant-isolation/ticket-queue-checks";
import { runTranscriptSliceChecks } from "./tenant-isolation/transcript-slice-checks";
import { runTrustedFieldChecks } from "./tenant-isolation/trusted-field-checks";
import { runUiPolishChecks } from "./tenant-isolation/ui-polish-checks";
import { runUndeliveredEmailChecks } from "./tenant-isolation/undelivered-email-checks";
import { runUnconfirmedInviteeChecks } from "./tenant-isolation/unconfirmed-invitee-checks";
import { runVapiChecks } from "./tenant-isolation/vapi-checks";
import { runVapiToolChecks } from "./tenant-isolation/vapi-tool-checks";
import { runVapiToolLookupChecks } from "./tenant-isolation/vapi-tool-lookup-checks";
import { runVerificationChecks } from "./tenant-isolation/verification-checks";

async function runChecksAndCleanUp() {
  // Before anything touches the database or a service. (Loading the modules
  // above connects to nothing: the pool connects on its first query.)
  const reasonNotToRun = findReasonNotToRunChecks(process.env);
  if (reasonNotToRun) {
    console.error(`Refusing to run the checks: ${reasonNotToRun}`);
    process.exit(1);
  }
  try {
    const ownerA = await signUpTestOwner("a");
    const ownerB = await signUpTestOwner("b");
    await runSignupChecks(ownerA, ownerB);
    await runVerificationChecks();
    await runAuthHandlerChecks();
    await runTakeoverChecks();
    await runPasswordResetChecks();
    await runUnconfirmedInviteeChecks();
    await runLoginLimitChecks();
    await runKnownDeviceChecks();
    await runLoginRedirectChecks(ownerA);
    await runAccountChecks(ownerB);
    await runTicketChecks(ownerA, ownerB);
    await runInviteChecks(ownerA, ownerB);
    await runInviteLimitChecks();
    await runAssignmentChecks(ownerA, ownerB);
    await runEmailChecks(ownerA, ownerB);
    await runVapiChecks(ownerA, ownerB);
    await runBrainGuardChecks();
    await runBrainEvidenceChecks();
    await runTranscriptSliceChecks();
    await runClaudeAdapterChecks();
    await runClaudeAdapterPlanChecks();
    await runClaudeAdapterDraftChecks();
    await runClaudeAdapterCalendarChecks();
    await runBrainAnalysisChecks(ownerA, ownerB);
    await runCallTicketChecks(ownerA, ownerB);
    await runTicketEmailChecks(ownerA, ownerB);
    await runClosingChecks(ownerB);
    await runCustomerEmailSafetyChecks();
    await runCategoryChecks(ownerA, ownerB);
    await runRoutingChecks(ownerA, ownerB);
    await runTeamChecks(ownerB);
    await runRemovalChecks();
    await runOwnerInviteChecks();
    await runTicketEligibilityChecks();
    await runPaginationChecks(ownerB);
    await runTicketQueueChecks();
    await runCallListChecks();
    await runRepeatCustomerChecks();
    await runBacklogRoutingChecks();
    await runNotificationChecks(ownerA, ownerB);
    await runRecordingChecks(ownerA, ownerB);
    await runInboundEmailChecks(ownerA, ownerB);
    await runSenderAuthenticationChecks(ownerA, ownerB);
    await runInboundRecoveryChecks();
    await runResendReceivingChecks();
    await runInboundContentChecks(ownerB);
    await runEmailSliceChecks();
    await runInboundFilterChecks();
    await runEmailsPageChecks();
    await runUndeliveredEmailChecks();
    await runStuckWorkChecks();
    await runBrainFailureChecks();
    await runFailureReportChecks();
    await runCustomerEmailChecks();
    await runForwardingChecks(ownerA, ownerB);
    await runForwardingSetupChecks(ownerA, ownerB);
    await runSetupChecks(ownerA, ownerB);
    await runOpsChecks(ownerA, ownerB);
    await runBillingChecks(ownerA, ownerB);
    await runBillingCompanyChecks(ownerB);
    await runTrustedFieldChecks();
    await runOutboxClaimChecks();
    await runConcurrencyChecks();
    await runCategoryLimitChecks();
    await runControlCharacterChecks();
    await runDocumentCapChecks();
    await runFileFailureChecks();
    await runTicketNoteChecks(ownerA, ownerB);
    await runTicketHistoryChecks();
    await runTicketChangeChecks();
    await runManualTicketChecks();
    await runCallEscalationChecks();
    await runTicketDetailsChecks();
    await runFirstRunChecks();
    await runKnowledgeChecks(ownerA, ownerB);
    await runKnowledgeIndexChecks();
    await runKnowledgePermissionChecks();
    await runKnowledgeRaceChecks();
    await runKnowledgeTextChecks(ownerA);
    await runKnowledgeZipChecks();
    await runKnowledgeFetchChecks();
    await runKnowledgeImportChecks(ownerA, ownerB);
    await runVapiToolChecks();
    await runVapiToolLookupChecks();
    await runCofounderChecks();
    await runContentStudioChecks();
    await runMediaChecks();
    await runSocialChecks();
    await runPublishingChecks();
    await runCalendarPlanChecks();
    await runAnalyticsChecks();
    await runOneProductChecks();
    await runUiPolishChecks();
    await runPageHeadingChecks();
    await runHygieneChecks(ownerA);
    await runLintGuardChecks();
    await runOperatorScriptChecks();
    // Last: the cleanup checks delete every old counter, session and reset
    // link, as the daily job does, and one check ends a pooled connection.
    await runOpsReadinessChecks();
    await runOpsMaintenanceChecks(ownerB);
  } finally {
    await cleanUpTestData();
    await db.$client.end();
  }

  const failures = getFailureCount();
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll tenant isolation checks passed.");
}

runChecksAndCleanUp().catch((error) => {
  console.error("Could not run the checks:", error);
  process.exit(1);
});
