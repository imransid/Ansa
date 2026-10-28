import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import type { SameCustomerTicket } from "@/services/tickets";

// The customer's other open tickets (same phone number or email, step 29),
// so whoever picks this one up sees the whole story and nobody calls the
// customer back twice with different answers. Hidden when there are none.
export function SameCustomerTickets({ tickets }: { tickets: SameCustomerTicket[] }) {
  if (tickets.length === 0) {
    return null;
  }
  return (
    <section className="grid min-w-0 gap-2 wrap-anywhere">
      <h2 className="text-lg font-semibold">Other open tickets from this customer</h2>
      <ul className="grid gap-1 text-sm">
        {tickets.map((ticket) => (
          <li key={ticket.ticketNumber}>
            <Link href={`/tickets/${ticket.ticketNumber}`} className="underline">
              #{ticket.ticketNumber} {ticket.subject}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {ticket.assigneeName ?? "Unassigned"} · <LocalDateTime iso={ticket.createdAt.toISOString()} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
