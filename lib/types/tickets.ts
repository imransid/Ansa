import type { tickets } from "@/db/schema";
import type { TicketView } from "@/lib/validation/list-queries";

// A ticket as the request pages read it: a row of the list, one whole
// ticket with the names of the people on it, and how many tickets each
// view of the list holds.

export type Ticket = typeof tickets.$inferSelect;

export type TicketListItem = Pick<
  Ticket,
  | "id"
  | "ticketNumber"
  | "subject"
  | "status"
  | "channel"
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "category"
  | "createdAt"
> & {
  assigneeName: string | null;
  // Shown when the pointer rests on the name: two teammates can share a name.
  assigneeEmail: string | null;
};

export type TicketDetail = Ticket & {
  assigneeName: string | null;
  solvedByName: string | null;
  customerEmailSetByName: string | null;
};

// How many tickets each view of the list holds (step 29).
export type TicketViewCounts = Record<TicketView, number>;
