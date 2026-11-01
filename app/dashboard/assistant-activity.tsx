import Link from "next/link";
import { ConciergeBell } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { ACTIVITY_TEXT } from "@/lib/conversations";
import { contactLabel } from "@/lib/inbox";
import type { ActivityRow } from "@/lib/types/conversations";

// Home's "What ansa did" (step 47): the assistant's newest work, as a service
// log (the time on the left, one line each), each line a link to its
// conversation. Never a message's text.
export function AssistantActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <section aria-labelledby="assistant-activity-heading" className="grid gap-2">
      <h2 id="assistant-activity-heading" className="flex items-center gap-2 text-lg font-semibold">
        <ConciergeBell aria-hidden className="size-4 text-link" />
        What ansa did
      </h2>
      {rows.length === 0 ? (
        <p className="border-y py-3 text-sm text-muted-foreground">Nothing yet. Every message ansa answers, and every note it takes for you, shows here.</p>
      ) : (
        <ol className="divide-y border-y">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/inbox/${row.conversationId}`} className="grid gap-1 py-2.5 text-sm hover:text-link sm:grid-cols-[11rem_1fr]">
                <span className="text-subtle-foreground numbers">
                  <LocalDateTime iso={row.createdAt.toISOString()} />
                </span>
                <span>
                  {ACTIVITY_TEXT[row.action]}: {contactLabel({ displayName: row.contactName, externalId: "" }) || "a customer"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
