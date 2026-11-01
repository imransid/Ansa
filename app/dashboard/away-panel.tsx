import Link from "next/link";
import { ConciergeBell } from "lucide-react";
import { markAwaySummarySeenAction } from "@/app/actions/away";
import { ActionButton } from "@/components/action-button";
import { LocalDateTime } from "@/components/local-date-time";
import { HANDOVER_REASON_TEXT } from "@/lib/assistant/reasons";
import { contactLabel } from "@/lib/inbox";
import type { getAwaySummaryForSession } from "@/services/away";

type AwaySummary = Awaited<ReturnType<typeof getAwaySummaryForSession>>;

// "While you were away": what ansa did since you last pressed "Got it",
// each conversation once, the ones that need you first in the words.
export function AwaySummaryCard({ summary }: { summary: AwaySummary }) {
  if (summary.conversations.length === 0) {
    return null;
  }
  const counts = [
    summary.replies > 0 ? `answered ${summary.replies} ${summary.replies === 1 ? "message" : "messages"}` : "",
    summary.notes > 0 ? `took ${summary.notes} ${summary.notes === 1 ? "note" : "notes"} for you` : "",
    summary.waiting > 0 ? `wrote ${summary.waiting} ${summary.waiting === 1 ? "reply" : "replies"} waiting for you` : "",
  ].filter(Boolean);
  return (
    <section aria-labelledby="away-summary-heading" className="grid gap-3 rounded-2xl border bg-card p-5">
      <div className="grid gap-1">
        <h2 id="away-summary-heading" className="flex items-center gap-2 text-lg font-semibold">
          <ConciergeBell aria-hidden className="size-4 text-link" />
          While you were away
        </h2>
        <p className="text-sm text-muted-foreground">
          Since <LocalDateTime iso={summary.since.toISOString()} />, ansa {counts.join(", ")}.
        </p>
      </div>
      <ol className="divide-y border-y">
        {summary.conversations.map((line) => (
          <li key={line.conversationId}>
            <Link href={`/inbox/${line.conversationId}`} className="grid gap-0.5 py-2.5 text-sm hover:text-link">
              <span className="font-medium">{contactLabel({ displayName: line.contactName, externalId: "" }) || "Someone"}</span>
              <span className="text-muted-foreground">
                {line.action === "handed_over"
                  ? `Needs you. ${line.reason ? HANDOVER_REASON_TEXT[line.reason] : ""}`
                  : line.action === "drafted"
                    ? "A reply waits for you to send it."
                    : "ansa answered."}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <ActionButton action={markAwaySummarySeenAction} fields={{}} label="Got it" accessibleLabel="Got it: clear the summary" />
    </section>
  );
}
