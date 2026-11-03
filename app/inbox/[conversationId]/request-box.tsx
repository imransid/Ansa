import Link from "next/link";
import { finishChatRequestAction } from "@/app/actions/conversations";
import { RelatedArticles } from "@/app/tickets/[ticketNumber]/related-knowledge";
import { TicketActions } from "@/app/tickets/[ticketNumber]/ticket-actions";
import { NoteForm } from "@/app/tickets/[ticketNumber]/note-form";
import { ActionButton } from "@/components/action-button";
import { StatusDot } from "@/components/status-dot";
import type { ConversationView } from "@/lib/core-views/inbox";
import type { RelatedArticle } from "@/lib/types/knowledge-search";

type RequestBoxProps = {
  conversation: ConversationView;
  ticket: NonNullable<ConversationView["openTicket"]>;
  teamMembers: Parameters<typeof TicketActions>[0]["teamMembers"];
  // A business with more than one person who takes requests.
  canAssign: boolean;
  canReopen: boolean;
  // The request page's "Related knowledge" (found by core with the request).
  relatedArticles: RelatedArticle[];
};

// "Needs you" on a conversation's page (step 47; simpler since the "easy to
// use" pass of 2026-11-01): the open request, what it is about (the AI's
// summary, a call's note), and the saved answers that match it. A chat's
// has one main button, Done, and the rest folded under More; a call's or an
// email's keeps the request's own actions (an email may go to the customer).
export function RequestBox({ conversation, ticket, teamMembers, canAssign, canReopen, relatedArticles }: RequestBoxProps) {
  return (
    <section aria-labelledby="request-heading" className="grid min-w-0 gap-3 rounded-2xl border p-5">
      <StatusDot tone="attention">Needs you</StatusDot>
      <h2 id="request-heading" className="text-lg font-semibold wrap-anywhere">
        {ticket.subject}
      </h2>
      {/* Plain text: what the AI or a person wrote, never markup. */}
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">{ticket.description}</p>
      {conversation.canReply && !ticket.customerEmail ? (
        // A chat (the "easy to use" pass of 2026-11-01): answer in the
        // box, then Done, which closes the request without an email (a
        // chat has none to send) and hands the conversation back to
        // ansa (core: POST /api/v1/conversations/{id}/done).
        <>
          <p className="text-sm text-muted-foreground">
            ansa told them you&apos;ll get back to them. Answer them here, then press Done: ansa takes care of them again after that.
          </p>
          <ActionButton
            action={finishChatRequestAction}
            fields={{ ticketId: ticket.id, conversationId: conversation.id }}
            label="Done"
            accessibleLabel="Done: this is sorted, ansa may answer them again"
            look="primary"
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">More</summary>
            <div className="mt-3 grid gap-3">
                            {canAssign && (
                <TicketActions
                  ticketId={ticket.id}
                  ticketNumber={ticket.ticketNumber}
                  status={ticket.status}
                  customerEmail={ticket.customerEmail}
                  assignedToUserId={ticket.assignedToUserId}
                  teamMembers={teamMembers}
                  canReopen={canReopen}
                />
              )}
              <NoteForm ticketId={ticket.id} />
              <Link href={`/tickets/${ticket.ticketNumber}`} className="underline">
                Open the request&apos;s own page
              </Link>
            </div>
          </details>
        </>
      ) : (
        <>
          <TicketActions
            ticketId={ticket.id}
            ticketNumber={ticket.ticketNumber}
            status={ticket.status}
            customerEmail={ticket.customerEmail}
            assignedToUserId={ticket.assignedToUserId}
            teamMembers={teamMembers}
            canReopen={canReopen}
          />
          <NoteForm ticketId={ticket.id} />
          <Link href={`/tickets/${ticket.ticketNumber}`} className="text-sm underline">
            Open the whole request (customer email, category, history)
          </Link>
        </>
      )}
      <div className="grid min-w-0 gap-2 wrap-anywhere">
        <h3 className="text-sm font-semibold">Related knowledge</h3>
        <RelatedArticles articles={relatedArticles} />
      </div>
    </section>
  );
}
