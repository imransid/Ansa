import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot } from "@/components/status-dot";
import { CHANNEL_LABELS } from "@/lib/conversations";
import { contactLabel, isUnverifiedSender } from "@/lib/inbox";
import type { InboxRow } from "@/lib/types/conversations";

// The Inbox's rows (step 47): who, on which channel, the newest entry, when,
// and what waits (an open request) or who has it (a person took it over).
export function ConversationList({ rows }: { rows: InboxRow[] }) {
  return (
    <ul className="divide-y border-y">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={`/inbox/${row.id}`} className="grid gap-1 py-3 hover:bg-muted/40 sm:grid-cols-[1fr_auto] sm:gap-4 sm:px-2">
            <span className="grid min-w-0 gap-0.5">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{contactLabel(row)}</span>
                <span className="text-xs text-muted-foreground">
                  {CHANNEL_LABELS[row.channel]}
                  {isUnverifiedSender(row) ? " · sender not verified" : ""}
                </span>
              </span>
              <span className="truncate text-sm text-muted-foreground">{row.preview || "No messages yet"}</span>
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {row.openTicket && <StatusDot tone="attention">{`Needs you: ${row.openTicket.subject}`}</StatusDot>}
                {row.handledBy === "person" && <StatusDot tone="info">A person is handling it</StatusDot>}
              </span>
            </span>
            <span className="text-xs text-subtle-foreground sm:text-right">
              <LocalDateTime iso={row.lastActivityAt.toISOString()} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
