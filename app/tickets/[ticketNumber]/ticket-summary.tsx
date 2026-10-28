import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { LocalDateTime } from "@/components/local-date-time";
import { describeAssignment } from "@/lib/ticket-history-text";
import type { TicketDetail } from "@/services/tickets";
import { TicketDetailsForm } from "./ticket-details-form";

const CHANNEL_LABELS: Record<TicketDetail["channel"], string> = {
  phone: "phone",
  email: "email",
  // Typed in by a teammate (step 31).
  manual: "added by hand",
};

// The top of the ticket page: number, subject, status, the request itself,
// and who, when and where from. The subject and the customer's name can be
// edited (step 31). Everything a customer or the AI wrote wraps anywhere
// (wrap-anywhere): one long link or token must never push the page wider
// than a phone's screen.
export function TicketSummary({ ticket }: { ticket: TicketDetail }) {
  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-xl font-semibold wrap-anywhere">
          #{ticket.ticketNumber} {ticket.subject}
        </h1>
        <Badge variant={ticket.status === "open" ? "default" : "secondary"}>
          {ticket.status}
        </Badge>
        <Badge variant="outline">{CHANNEL_LABELS[ticket.channel]}</Badge>
      </div>
      <p className="whitespace-pre-wrap wrap-anywhere rounded-lg border p-4">{ticket.description}</p>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm wrap-anywhere">
        <dt className="text-muted-foreground">Customer</dt>
        <dd>{ticket.customerName ?? "Unknown"}</dd>
        <dt className="text-muted-foreground">Phone</dt>
        <dd>{ticket.customerPhone ?? "-"}</dd>
        <dt className="text-muted-foreground">Assigned to</dt>
        <dd>{describeAssignment(ticket)}</dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd>
          <LocalDateTime iso={ticket.createdAt.toISOString()} />
        </dd>
        {ticket.callId && (
          <>
            <dt className="text-muted-foreground">From call</dt>
            <dd>
              {/* The transcript stays on the call page, encrypted at rest. */}
              <Link href={`/calls/${ticket.callId}`} className="underline">
                Open the call and its transcript
              </Link>
            </dd>
          </>
        )}
        {ticket.solvedAt && (
          <>
            <dt className="text-muted-foreground">Solved</dt>
            <dd>
              <LocalDateTime iso={ticket.solvedAt.toISOString()} /> by {ticket.solvedByName}
            </dd>
          </>
        )}
      </dl>
      <TicketDetailsForm ticketId={ticket.id} subject={ticket.subject} customerName={ticket.customerName} />
    </section>
  );
}
