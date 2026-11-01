import "server-only";
import type { CustomerEmailSummary } from "@/services/customer-emails";
import type { OriginalEmail } from "@/services/inbound-emails";
import type { RelatedArticle } from "@/services/knowledge-search";
import type { TicketHistory, TicketHistoryEntry } from "@/services/ticket-history";
import type { SameCustomerTicket } from "@/services/tickets";

// What core's request page (GET /api/v1/requests/{number}) sends around the
// request itself, in the shapes the ticket page's sections already read: its
// newest customer email, the email it came from, the same customer's other
// open requests, related knowledge and the history. Dates come as text.

export type CoreLatestEmail = {
  id: string;
  toEmail: string;
  status: CustomerEmailSummary["status"];
  lastError: string | null;
  sentAt: string | null;
  deliveryProblem: CustomerEmailSummary["deliveryProblem"];
  providerMessageId: string | null;
  inProgress: boolean;
  needsConfirmation: boolean;
};

export type CoreOriginalEmail = Omit<OriginalEmail, "receivedAt"> & { receivedAt: string };

export type CoreSameCustomer = Omit<SameCustomerTicket, "createdAt"> & { createdAt: string };

export type CoreHistoryEntry = {
  id: string;
  kind: TicketHistoryEntry["kind"];
  actorUserId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  category: string | null;
  // null for a change, and for a note that could not be decrypted (noteUnreadable).
  note: string | null;
  noteUnreadable: boolean;
  createdAt: string;
};

// The latest customer email's status line and Retry.
export function toCustomerEmailSummary(email: CoreLatestEmail | null): CustomerEmailSummary | null {
  if (!email) {
    return null;
  }
  return {
    id: email.id,
    status: email.status,
    toEmail: email.toEmail,
    sentAt: email.sentAt ? new Date(email.sentAt) : null,
    providerMessageId: email.providerMessageId,
    deliveryProblem: email.deliveryProblem,
    // The page only needs to know whether the daily limit held it back.
    heldBackByDailyLimit: email.lastError === "daily_limit",
    deliveryInProgress: email.inProgress,
    mayAlreadyHaveBeenDelivered: email.needsConfirmation,
  };
}

// "Original email" and the addresses "Use this address" offers.
export function toOriginalEmail(email: CoreOriginalEmail | null): OriginalEmail | null {
  if (!email) {
    return null;
  }
  return {
    fromAddress: email.fromAddress,
    senderVerified: email.senderVerified,
    replyToAddress: email.replyToAddress,
    subject: email.subject,
    body: email.body,
    bodyFromHtml: email.bodyFromHtml,
    attachmentCount: email.attachmentCount,
    attachmentNames: email.attachmentNames,
    inlineImageCount: email.inlineImageCount,
    unreadable: email.unreadable,
    receivedAt: new Date(email.receivedAt),
  };
}

export function toSameCustomerTicket(ticket: CoreSameCustomer): SameCustomerTicket {
  return { ticketNumber: ticket.ticketNumber, subject: ticket.subject, assigneeName: ticket.assigneeName, createdAt: new Date(ticket.createdAt) };
}

// Core's article already has the page's fields; only they are kept.
export function toRelatedArticle(article: RelatedArticle): RelatedArticle {
  return { articleId: article.articleId, title: article.title, kind: article.kind, text: article.text };
}

// The newest 200 entries, oldest first, and whether older ones exist.
export function toTicketHistory(entries: CoreHistoryEntry[], olderEntriesHidden: boolean): TicketHistory {
  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      actorUserId: entry.actorUserId,
      actorName: entry.actorName,
      targetUserId: entry.targetUserId,
      targetName: entry.targetName,
      category: entry.category,
      noteText: entry.note,
      noteUnreadable: entry.noteUnreadable,
      createdAt: new Date(entry.createdAt),
    })),
    olderEntriesHidden,
  };
}
