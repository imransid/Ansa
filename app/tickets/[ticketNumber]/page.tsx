import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { LocalDateTime } from "@/components/local-date-time";
import { requireSessionContext } from "@/lib/session";
import { listActiveCategoryNamesForSession } from "@/services/categories";
import { getLatestCustomerEmailForSession } from "@/services/customer-emails";
import { getDashboardSummary } from "@/services/dashboard";
import { getOriginalEmailForSession, type OriginalEmail } from "@/services/inbound-emails";
import { listTeamMembersForSession } from "@/services/team";
import { getTicketForSession, type TicketDetail } from "@/services/tickets";
import { CustomerEmailSection, type EmailOrigin } from "./customer-email-section";
import { CustomerEmailStatus } from "./customer-email-status";
import { TicketActions } from "./ticket-actions";
import { TicketCategoryForm } from "./ticket-category-form";

export const metadata: Metadata = { title: "Ticket - ansa" };

export default function TicketPage({
  params,
}: PageProps<"/tickets/[ticketNumber]">) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's ticket number are
          only known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <TicketContent params={params} />
      </Suspense>
    </main>
  );
}

async function TicketContent({
  params,
}: Pick<PageProps<"/tickets/[ticketNumber]">, "params">) {
  const { ticketNumber } = await params;
  const session = await requireSessionContext();
  const ticket = await getTicketForSession(session, ticketNumber);
  // Unknown number, bad number, or a number that only exists in another
  // company: all look the same, so nothing leaks about other companies.
  if (!ticket) {
    notFound();
  }

  const [summary, teamMembers, latestEmail, categoryNames, originalEmail] = await Promise.all([
    getDashboardSummary(session),
    listTeamMembersForSession(session),
    getLatestCustomerEmailForSession(session, ticket.id),
    listActiveCategoryNamesForSession(session),
    getOriginalEmailForSession(session, ticket.id),
  ]);

  return (
    <>
      <AppHeader summary={summary} />
      <Link href="/dashboard" className="text-sm hover:underline">
        &larr; All tickets
      </Link>
      <TicketSummary ticket={ticket} />
      {originalEmail && <OriginalEmailSection email={originalEmail} />}
      <CustomerEmailSection
        // A new key after every save puts the section back into "view" mode.
        key={`${ticket.customerEmail ?? "none"}-${ticket.customerEmailSetAt?.toISOString() ?? "never"}`}
        ticketId={ticket.id}
        customerEmail={ticket.customerEmail}
        origin={describeEmailOrigin(ticket)}
      />
      <CustomerEmailStatus ticket={ticket} latestEmail={latestEmail} />
      <TicketCategoryForm ticketId={ticket.id} category={ticket.category} categoryNames={categoryNames} />
      <TicketActions
        ticketId={ticket.id}
        status={ticket.status}
        assignedToUserId={ticket.assignedToUserId}
        teamMembers={teamMembers.map((member) => ({ id: member.id, name: member.name }))}
        canReopen={session.role === "owner"}
      />
    </>
  );
}

function TicketSummary({ ticket }: { ticket: TicketDetail }) {
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">
          #{ticket.ticketNumber} {ticket.subject}
        </h1>
        <Badge variant={ticket.status === "open" ? "default" : "secondary"}>
          {ticket.status}
        </Badge>
        <Badge variant="outline">{ticket.channel}</Badge>
      </div>
      <p className="whitespace-pre-wrap rounded-lg border p-4">{ticket.description}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
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
    </section>
  );
}

// Where the customer's email came from, shown next to the address.
function describeEmailOrigin(ticket: TicketDetail): EmailOrigin {
  if (!ticket.customerEmail) {
    return null;
  }
  if (ticket.customerEmailSetByName && ticket.customerEmailSetAt) {
    return { setByName: ticket.customerEmailSetByName, setAtIso: ticket.customerEmailSetAt.toISOString() };
  }
  return "came-with-ticket";
}

// Who has the ticket and how they got it (step 10): routed by category, or picked by a person.
function describeAssignment(ticket: TicketDetail): string {
  if (!ticket.assigneeName) {
    return "Nobody yet";
  }
  const how = ticket.assignedAutomatically
    ? `routed automatically${ticket.category ? ` (${ticket.category})` : ""}`
    : "assigned by a person";
  return `${ticket.assigneeName}, ${how}`;
}

// The customer's own email, for tickets that came in by email (step 15).
function OriginalEmailSection({ email }: { email: OriginalEmail }) {
  return (
    <section className="grid gap-2 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Original email</h2>
      <p className="text-sm text-muted-foreground">
        From {email.fromAddress ?? "unknown sender"}, <LocalDateTime iso={email.receivedAt.toISOString()} />
      </p>
      <p className="text-sm font-medium">{email.subject ?? "(no subject)"}</p>
      <pre className="whitespace-pre-wrap font-sans text-sm">{email.body ?? "(no plain-text body)"}</pre>
    </section>
  );
}
