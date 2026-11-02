import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestPageFromCore, type TicketView } from "@/lib/core-views/tickets";
import { getSessionContext, requireSessionContext } from "@/lib/session";
import type { OriginalEmail } from "@/lib/types/inbound-emails";
import { readCustomerEmail } from "@/lib/validation/customer-email";
import { listAssigneeMenu } from "./assignee-menu";
import { CustomerEmailSection, type EmailOrigin, type SuggestedEmail } from "./customer-email-section";
import { CustomerEmailStatus } from "./customer-email-status";
import { OriginalEmailSection } from "./original-email-section";
import { KnowledgeSection } from "./related-knowledge";
import { SameCustomerTickets } from "./same-customer-tickets";
import { TicketActions } from "./ticket-actions";
import { TicketCategoryForm } from "./ticket-category-form";
import { TicketHistorySection } from "./ticket-history";
import { TicketSummary } from "./ticket-summary";

// "#412 Refund not received - ansa", so several open ticket tabs can be told
// apart. The subject is one plain line already; a long one is cut here.
export async function generateMetadata({ params }: PageProps<"/tickets/[ticketNumber]">): Promise<Metadata> {
  const { ticketNumber } = await params;
  const session = await getSessionContext();
  // Logged out: the page sends them to /login.
  if (!session) {
    return { title: "Ticket - ansa" };
  }
  const ticket = (await getRequestPageFromCore(ticketNumber))?.ticket;
  if (!ticket) {
    return { title: "Ticket not found - ansa" };
  }
  const subject = ticket.subject.length > 60 ? `${ticket.subject.slice(0, 60).trimEnd()}...` : ticket.subject;
  return { title: `#${ticket.ticketNumber} ${subject} - ansa` };
}

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
  // Logging in brings them back to this ticket (an assignment email's link).
  const session = await requireSessionContext(`/tickets/${encodeURIComponent(ticketNumber)}`);
  // The request and everything the page shows around it, in one answer.
  const page = await getRequestPageFromCore(ticketNumber);
  // Unknown number, bad number, or a number that only exists in another
  // company: all look the same (./not-found.tsx), so nothing leaks about
  // other companies.
  if (!page) {
    notFound();
  }
  const { ticket, assigneeChoices, latestEmail, categoryNames, originalEmail, sameCustomerTickets, history, relatedArticles } = page;

  return (
    <>
      <Link href="/inbox" className="text-sm hover:underline">
        &larr; Inbox
      </Link>
      <TicketSummary ticket={ticket} />
      <SameCustomerTickets tickets={sameCustomerTickets} />
      {originalEmail && <OriginalEmailSection email={originalEmail} />}
      <KnowledgeSection ticketNumber={ticket.ticketNumber} isSolved={ticket.status === "solved"} articles={relatedArticles} />
      <CustomerEmailSection
        // A new key after every save puts the section back into "view" mode.
        key={`${ticket.customerEmail ?? "none"}-${ticket.customerEmailSetAt?.toISOString() ?? "never"}`}
        ticketId={ticket.id}
        customerEmail={ticket.customerEmail}
        origin={describeEmailOrigin(ticket)}
        suggestions={suggestCustomerEmails(originalEmail, ticket)}
      />
      <CustomerEmailStatus ticket={ticket} latestEmail={latestEmail} />
      <TicketCategoryForm ticketId={ticket.id} category={ticket.category} categoryNames={categoryNames} />
      <TicketActions
        ticketId={ticket.id}
        ticketNumber={ticket.ticketNumber}
        status={ticket.status}
        customerEmail={ticket.customerEmail}
        assignedToUserId={ticket.assignedToUserId}
        teamMembers={listAssigneeMenu(assigneeChoices, ticket)}
        canReopen={session.role === "owner"}
      />
      <TicketHistorySection ticketId={ticket.id} ticketCreatedAt={ticket.createdAt} history={history} />
    </>
  );
}

// Where the customer's email came from, shown next to the address.
function describeEmailOrigin(ticket: TicketView): EmailOrigin {
  if (!ticket.customerEmail) {
    return null;
  }
  if (ticket.customerEmailSetByName && ticket.customerEmailSetAt) {
    return { setByName: ticket.customerEmailSetByName, setAtIso: ticket.customerEmailSetAt.toISOString() };
  }
  return "came-with-ticket";
}

// Addresses from the original email that were not filled in on their own,
// for "Use this address" (steps 25 and 27): the Reply-To (a contact form puts
// the customer there), and the sender unless it was filled in. None on a
// ticket closed without emailing: that was on purpose (spam, a forged
// sender), so nothing should invite emailing it later.
function suggestCustomerEmails(originalEmail: OriginalEmail | null, ticket: TicketView): SuggestedEmail[] {
  if (!originalEmail || ticket.solvedWithoutEmail) {
    return [];
  }
  const suggestions: SuggestedEmail[] = [];
  if (originalEmail.replyToAddress) {
    suggestions.push({ address: originalEmail.replyToAddress, kind: "reply-to" });
  }
  // A From that holds no valid address can't be saved, so it isn't offered.
  const sender = readCustomerEmail(originalEmail.fromAddress ?? "");
  if (sender && !originalEmail.senderVerified) {
    suggestions.push({ address: sender, kind: "unverified-sender" });
  }
  if (sender && originalEmail.senderVerified && originalEmail.replyToAddress) {
    suggestions.push({ address: sender, kind: "sender-with-reply-to" });
  }
  return suggestions;
}
