import "server-only";
import { and, eq, ilike, inArray, isNotNull, isNull, like, or, type SQL } from "drizzle-orm";
import { containsPattern, phoneDigitsInSearch, ticketNumberInSearch } from "@/lib/search-patterns";
import type { TicketView } from "@/lib/validation/list-queries";
import { db } from "./client";
import { phoneDigitsOf } from "./phone-digits";
import { inboundEmails, tickets } from "./schema";

// The conditions behind the ticket list's views and search (step 29). Never
// use them on their own: db/tickets.ts puts eq(tickets.companyId, companyId)
// first in every query that uses them.

// The tickets one view shows. viewerUserId is the logged-in person, from the
// session: "mine" lists their open tickets. "all" adds no condition.
export function ticketViewCondition(view: TicketView, viewerUserId: string): SQL | undefined {
  switch (view) {
    case "open":
      return eq(tickets.status, "open");
    case "mine":
      return and(eq(tickets.status, "open"), eq(tickets.assignedToUserId, viewerUserId));
    case "unassigned":
      return and(eq(tickets.status, "open"), isNull(tickets.assignedToUserId));
    case "solved":
      return eq(tickets.status, "solved");
    case "all":
      return undefined;
  }
}

// The tickets a search finds: the text anywhere in the subject, the
// customer's name, email or phone, or the address the original email came
// from; a phone number however it is written; and "#57" or "57" finds ticket
// 57. Every value goes to Postgres as a parameter, never as SQL text.
export function ticketSearchCondition(companyId: string, search: string | null): SQL | undefined {
  if (!search) {
    return undefined;
  }
  const pattern = containsPattern(search);
  const conditions: SQL[] = [
    ilike(tickets.subject, pattern),
    ilike(tickets.customerName, pattern),
    ilike(tickets.customerEmail, pattern),
    ilike(tickets.customerPhone, pattern),
    originalEmailCameFrom(companyId, pattern),
  ];
  const digits = phoneDigitsInSearch(search);
  if (digits) {
    conditions.push(like(phoneDigitsOf(tickets.customerPhone), `%${digits}%`));
  }
  const ticketNumber = ticketNumberInSearch(search);
  if (ticketNumber) {
    conditions.push(eq(tickets.ticketNumber, ticketNumber));
  }
  return or(...conditions);
}

// WHY the received email too: an email ticket gets its customer email only
// when the sender is verified (step 25), so a customer whose mail wasn't
// verified, or who wrote through a contact form (Reply-To), is found by the
// From or Reply-To address kept on the email. Same company only. Written as
// "id IN (one list)" rather than a lookup per ticket: Postgres builds that
// list once per search (the addresses are matched with ILIKE, which no index
// helps), instead of once for every ticket it looks at.
function originalEmailCameFrom(companyId: string, pattern: string): SQL {
  return inArray(
    tickets.id,
    db
      .select({ ticketId: inboundEmails.ticketId })
      .from(inboundEmails)
      .where(
        and(
          eq(inboundEmails.companyId, companyId),
          isNotNull(inboundEmails.ticketId),
          or(ilike(inboundEmails.fromAddress, pattern), ilike(inboundEmails.replyToAddress, pattern)),
        ),
      ),
  );
}
