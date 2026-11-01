import type { TicketActivityKind } from "@/db/schema";

// A ticket's notes and history (step 30), as its page shows them.

// How many of a ticket's newest entries the ticket page shows. Notes are
// limited per person (ticket-changes), not per ticket, so a page must stop somewhere.
// (A constant beside the types: the page says this number when older
// entries are hidden.)
export const HISTORY_LIMIT = 200;

export type TicketHistoryEntry = {
  id: string;
  kind: TicketActivityKind;
  actorUserId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  category: string | null;
  // Notes only: the text, or null when it can't be decrypted (noteUnreadable).
  noteText: string | null;
  noteUnreadable: boolean;
  createdAt: Date;
};

export type TicketHistory = {
  // Oldest first, as the page reads them.
  entries: TicketHistoryEntry[];
  // The ticket has more, older entries than HISTORY_LIMIT; they are not shown.
  olderEntriesHidden: boolean;
};
