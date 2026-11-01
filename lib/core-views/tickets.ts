import "server-only";
import { cache } from "react";
import { callCore } from "@/lib/core-api";
import {
  toCustomerEmailSummary,
  toOriginalEmail,
  toRelatedArticle,
  toSameCustomerTicket,
  toTicketHistory,
  type CoreHistoryEntry,
  type CoreLatestEmail,
  type CoreOriginalEmail,
  type CoreSameCustomer,
} from "@/lib/core-views/ticket-context";
import type { CategoryChoice } from "@/lib/types/categories";
import type { OriginalEmail } from "@/lib/types/inbound-emails";
import type { RelatedArticle } from "@/lib/types/knowledge-search";
import type { CustomerEmailSummary } from "@/lib/types/outgoing-emails";
import type { SameCustomerTicket } from "@/lib/types/same-customer";
import type { TicketHistory } from "@/lib/types/ticket-history";
import type { TicketDetail, TicketListItem, TicketViewCounts } from "@/lib/types/tickets";
import type { AssignableUser } from "@/lib/types/users";
import type { TicketListQuery } from "@/lib/validation/list-queries";

// The request (ticket) screens through the new backend (core's
// /api/v1/requests), in the shapes the pages already read: All requests, one
// request's page and "New ticket". Their actions: ticket-actions.ts.

// What the ticket page and a conversation's request box read of a request.
// Both backends give it: core leaves out the user ids behind the names, who
// routing picked first and when the row last changed, which no page shows.
export type TicketView = Omit<TicketDetail, "companyId" | "customerEmailSetByUserId" | "routedToUserId" | "solvedByUserId" | "updatedAt">;

// One request as core's JSON has it (dates as text).
type CoreRequest = {
  id: string;
  number: number;
  subject: string;
  description: string;
  status: TicketView["status"];
  channel: TicketView["channel"];
  category: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  assignedToUserId: string | null;
  assigneeName: string | null;
  assignedAutomatically: boolean | null;
  solvedAt: string | null;
  solvedByName: string | null;
  solvedWithoutEmail: boolean;
  customerEmailSetByName: string | null;
  customerEmailSetAt: string | null;
  conversationId: string | null;
  callId: string | null;
  createdAt: string;
  // The newest 200 entries, oldest first.
  history: CoreHistoryEntry[];
  olderEntriesHidden: boolean;
};

// Everything core's request page answers (ticket-context.ts has the parts around the request).
type CoreRequestPage = {
  request: CoreRequest;
  people: AssignableUser[];
  categories: string[];
  latestEmail: CoreLatestEmail | null;
  originalEmail: CoreOriginalEmail | null;
  sameCustomer: CoreSameCustomer[];
  relatedKnowledge: RelatedArticle[];
};

type CoreLine = Omit<TicketListItem, "ticketNumber" | "createdAt"> & { number: number; createdAt: string };

// One request's page: the request, who it can be given to, the categories,
// and everything its sections show around it.
export type RequestPage = {
  ticket: TicketView;
  assigneeChoices: AssignableUser[];
  categoryNames: string[];
  latestEmail: CustomerEmailSummary | null;
  originalEmail: OriginalEmail | null;
  sameCustomerTickets: SameCustomerTicket[];
  relatedArticles: RelatedArticle[];
  history: TicketHistory;
};

// One page of All requests in one view, with the search, and every view's count.
export async function listRequestsFromCore(page: number, query: TicketListQuery): Promise<{ tickets: TicketListItem[]; counts: TicketViewCounts }> {
  const search = new URLSearchParams({ view: query.view, q: query.search ?? "", page: String(page) });
  const answer = await callCore<{ lines: CoreLine[]; counts: TicketViewCounts }>("GET", `/api/v1/requests?${search}`);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { tickets: answer.data.lines.map(toListItem), counts: answer.data.counts };
}

// One request by its number from the URL, or null when this company has none
// (the page's not-found). One read per page view: the tab title, the page
// and a conversation's request box may all ask for it.
export const getRequestPageFromCore = cache(async (ticketNumber: string): Promise<RequestPage | null> => {
  const answer = await callCore<CoreRequestPage>("GET", `/api/v1/requests/${encodeURIComponent(ticketNumber)}`);
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const page = answer.data;
  return {
    ticket: toTicketView(page.request),
    assigneeChoices: page.people.map((person) => ({ id: person.id, name: person.name, email: person.email })),
    categoryNames: page.categories,
    latestEmail: toCustomerEmailSummary(page.latestEmail),
    originalEmail: toOriginalEmail(page.originalEmail),
    sameCustomerTickets: page.sameCustomer.map(toSameCustomerTicket),
    relatedArticles: page.relatedKnowledge.map(toRelatedArticle),
    history: toTicketHistory(page.request.history, page.request.olderEntriesHidden),
  };
});

// The company's active categories, for "New ticket" (from the Team page's read).
export async function listActiveCategoriesFromCore(): Promise<CategoryChoice[]> {
  const answer = await callCore<{ team: { categories: { id: string; name: string; archived: boolean }[] } }>("GET", "/api/v1/team");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return answer.data.team.categories.filter((category) => !category.archived).map((category) => ({ id: category.id, name: category.name }));
}

function toListItem(line: CoreLine): TicketListItem {
  return {
    id: line.id,
    ticketNumber: line.number,
    subject: line.subject,
    status: line.status,
    channel: line.channel,
    customerName: line.customerName,
    customerEmail: line.customerEmail,
    customerPhone: line.customerPhone,
    category: line.category,
    createdAt: new Date(line.createdAt),
    assigneeName: line.assigneeName,
    assigneeEmail: line.assigneeEmail,
  };
}

// Field by field: core's request also holds the history (notes included),
// which goes to the page apart (RequestPage.history), not with the request.
function toTicketView(request: CoreRequest): TicketView {
  return {
    id: request.id,
    ticketNumber: request.number,
    subject: request.subject,
    description: request.description,
    status: request.status,
    channel: request.channel,
    category: request.category,
    customerName: request.customerName,
    customerEmail: request.customerEmail,
    customerEmailSetByName: request.customerEmailSetByName,
    customerEmailSetAt: request.customerEmailSetAt ? new Date(request.customerEmailSetAt) : null,
    customerPhone: request.customerPhone,
    assignedToUserId: request.assignedToUserId,
    assigneeName: request.assigneeName,
    assignedAutomatically: request.assignedAutomatically,
    solvedAt: request.solvedAt ? new Date(request.solvedAt) : null,
    solvedByName: request.solvedByName,
    solvedWithoutEmail: request.solvedWithoutEmail,
    callId: request.callId,
    conversationId: request.conversationId,
    createdAt: new Date(request.createdAt),
  };
}
