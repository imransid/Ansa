import Link from "next/link";
import { describeReason, isModelFailureReason } from "@/lib/call-brain/reasons";
import { LocalDateTime } from "@/components/local-date-time";
import type { CallDetail } from "@/services/calls";
import type { CategoryChoice } from "@/services/categories";
import { DecisionBadge } from "../decision-badge";
import { AnalyzeNowButton } from "./analyze-now-button";
import { EscalateCallForm } from "./escalate-call-form";

type CallDecisionProps = {
  call: CallDetail;
  // For "Escalate to a ticket": the company's active categories.
  categories: CategoryChoice[];
};

// What the call brain decided about this call, and why. A call it marked
// solved can be escalated to a ticket (step 31).
export function CallDecision({ call, categories }: CallDecisionProps) {
  const { analysis } = call;

  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">AI decision</h2>
        <DecisionBadge analysisStatus={call.analysisStatus} aiOutcome={call.aiOutcome} escalated={call.escalation !== null} />
      </div>

      {call.analysisStatus === "decided" && (
        // minmax(0, 1fr) + wrap-anywhere: long words or links in what Claude
        // or the customer said wrap instead of widening the page.
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm wrap-anywhere">
          <dt className="text-muted-foreground">Customer issue</dt>
          <dd>{analysis.issue ?? "-"}</dd>
          {analysis.evidence && (
            <>
              {/* The sentence the "solved" rests on, from the transcript. */}
              <dt className="text-muted-foreground">Customer confirmed</dt>
              <dd>&ldquo;{analysis.evidence}&rdquo;</dd>
            </>
          )}
          <dt className="text-muted-foreground">Why</dt>
          <dd>{analysis.explanation ?? describeReason(analysis.reasonCode, analysis.errorClass)}</dd>
          <dt className="text-muted-foreground">Decided by</dt>
          <dd>
            {describeDecider(analysis)}
            {analysis.decidedAt && (
              <>
                , <LocalDateTime iso={analysis.decidedAt.toISOString()} />
              </>
            )}
          </dd>
          <dt className="text-muted-foreground">Reason code</dt>
          <dd>
            <code>{analysis.reasonCode}</code>{" "}
            {analysis.explanation && <>{describeReason(analysis.reasonCode, analysis.errorClass)}</>}
          </dd>
        </dl>
      )}

      {call.ticketNumber !== null && <TicketLine call={call} ticketNumber={call.ticketNumber} />}

      {analysis.canAnalyzeNow && <AnalyzeNowButton callId={call.id} />}
      {analysis.canEscalate && <EscalateCallForm callId={call.id} categories={categories} />}
    </section>
  );
}

// The call's ticket, and who escalated it when the AI had said solved.
function TicketLine({ call, ticketNumber }: { call: CallDetail; ticketNumber: number }) {
  const ticketLink = (
    <Link href={`/tickets/${ticketNumber}`} className="font-medium underline">
      ticket #{ticketNumber}
    </Link>
  );
  if (!call.escalation) {
    return <p className="text-sm">Escalated to {ticketLink}</p>;
  }
  return (
    <p className="text-sm">
      {call.escalation.byName ?? "A teammate"} escalated it to {ticketLink} on{" "}
      <LocalDateTime iso={call.escalation.at.toISOString()} />. The AI&apos;s verdict stays recorded as solved.
    </p>
  );
}

// Who decided: Claude, or a rule. When Claude was asked but gave no usable
// answer (an error, a refusal, a malformed or cut-off answer), a rule
// escalated the call, so it doesn't say "Claude" as if Claude had judged it.
function describeDecider(analysis: CallDetail["analysis"]): string {
  const model = analysis.model ?? "unknown model";
  if (analysis.source !== "model") {
    return "A rule (Claude was not asked)";
  }
  if (isModelFailureReason(analysis.reasonCode)) {
    return `A rule, because Claude (${model}) gave no usable answer`;
  }
  return `Claude (${model})`;
}
