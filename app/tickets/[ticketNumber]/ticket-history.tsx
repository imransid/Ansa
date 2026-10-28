import { LocalDateTime } from "@/components/local-date-time";
import { describeTicketActivity, historyNamesItsCreator } from "@/lib/ticket-history-text";
import { HISTORY_LIMIT, type TicketHistory, type TicketHistoryEntry } from "@/services/ticket-history";
import { NoteForm } from "./note-form";

type TicketHistorySectionProps = {
  ticketId: string;
  ticketCreatedAt: Date;
  history: TicketHistory;
};

// The ticket's notes and history (step 30), oldest first, then the box to add
// a note. Notes are for the team only: never emailed to the customer.
export function TicketHistorySection({ ticketId, ticketCreatedAt, history }: TicketHistorySectionProps) {
  const showCreatedLine = !history.olderEntriesHidden && !historyNamesItsCreator(history.entries.map((entry) => entry.kind));
  return (
    <section className="grid min-w-0 gap-3 rounded-lg border p-4 wrap-anywhere">
      <h2 className="text-lg font-semibold">Notes and history</h2>
      {history.olderEntriesHidden && (
        <p className="text-sm text-muted-foreground">Only the latest {HISTORY_LIMIT} entries are shown.</p>
      )}
      <ol className="grid gap-3">
        {/* The ticket row itself records when it was created. Left out when
            older entries are hidden (it would sit next to a gap), and when
            the history's first entry already says who created it. */}
        {showCreatedLine && (
          <li className="text-sm text-muted-foreground">
            <LocalDateTime iso={ticketCreatedAt.toISOString()} /> · Ticket created
          </li>
        )}
        {history.entries.map((entry) =>
          entry.kind === "note" ? <NoteEntry key={entry.id} entry={entry} /> : <ChangeEntry key={entry.id} entry={entry} />,
        )}
      </ol>
      <NoteForm ticketId={ticketId} />
    </section>
  );
}

function ChangeEntry({ entry }: { entry: TicketHistoryEntry }) {
  return (
    <li className="text-sm text-muted-foreground">
      <LocalDateTime iso={entry.createdAt.toISOString()} /> · {describeTicketActivity(entry)}
    </li>
  );
}

function NoteEntry({ entry }: { entry: TicketHistoryEntry }) {
  return (
    <li className="grid gap-1 rounded-md border bg-muted/40 p-3">
      <p className="text-sm">
        <strong>{entry.actorName ?? "Someone"}</strong>
        <span className="text-muted-foreground">
          {" "}
          · <LocalDateTime iso={entry.createdAt.toISOString()} />
        </span>
      </p>
      {entry.noteUnreadable ? (
        // What went wrong is in the server log (lib/encryption.ts), not here.
        <p role="alert" className="text-sm text-destructive">
          This note can&apos;t be shown right now. If this keeps happening, contact ansa support.
        </p>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{entry.noteText}</p>
      )}
    </li>
  );
}
