import { REASON_LABELS, type ReasonCode } from "@/lib/call-brain/decision";
import { formatUtcDateTime } from "@/lib/format-date";
import type { CallDetail } from "@/services/calls";
import { DecisionBadge } from "../decision-badge";
import { AnalyzeNowButton } from "./analyze-now-button";

// What the call brain decided about this call, and why.
export function CallDecision({ call }: { call: CallDetail }) {
  const { analysis } = call;

  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">AI decision</h2>
        <DecisionBadge analysisStatus={call.analysisStatus} aiOutcome={call.aiOutcome} />
      </div>

      {call.analysisStatus === "decided" && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Customer issue</dt>
          <dd>{analysis.issue ?? "-"}</dd>
          <dt className="text-muted-foreground">Why</dt>
          <dd>{analysis.explanation ?? reasonLabel(analysis.reasonCode)}</dd>
          <dt className="text-muted-foreground">Decided by</dt>
          <dd>
            {analysis.source === "model" ? `Claude (${analysis.model ?? "unknown model"})` : "A rule (Claude was not asked)"}
            {analysis.decidedAt && `, ${formatUtcDateTime(analysis.decidedAt)} (UTC)`}
          </dd>
          <dt className="text-muted-foreground">Reason code</dt>
          <dd>
            <code>{analysis.reasonCode}</code> {analysis.explanation && <>{reasonLabel(analysis.reasonCode)}</>}
          </dd>
        </dl>
      )}

      {analysis.canAnalyzeNow && <AnalyzeNowButton callId={call.id} />}
    </section>
  );
}

function reasonLabel(reasonCode: string | null): string {
  if (reasonCode && reasonCode in REASON_LABELS) {
    return REASON_LABELS[reasonCode as ReasonCode];
  }
  return "-";
}
