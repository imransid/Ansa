import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalDateTime } from "@/components/local-date-time";
import type { TicketListItem } from "@/services/tickets";

type TicketTableProps = {
  tickets: TicketListItem[];
  page: number;
};

export function TicketTable({ tickets, page }: TicketTableProps) {
  if (tickets.length === 0 && page > 1) {
    return (
      <p className="rounded-lg border p-6 text-center text-muted-foreground">
        Nothing on this page.{" "}
        <Link href="/dashboard" className="underline">
          Go to the first page
        </Link>
      </p>
    );
  }
  if (tickets.length === 0) {
    return (
      <p className="rounded-lg border p-6 text-center text-muted-foreground">
        No tickets yet. Tickets appear here when the AI can&apos;t solve a
        customer&apos;s problem.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Assigned to</TableHead>
          <TableHead>Channel</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TableRow key={ticket.id}>
            <TableCell className="font-medium">{ticket.ticketNumber}</TableCell>
            <TableCell>
              <Link href={`/tickets/${ticket.ticketNumber}`} className="hover:underline">
                {ticket.subject}
              </Link>
            </TableCell>
            <TableCell>{describeCustomer(ticket)}</TableCell>
            <TableCell>{ticket.category ?? "-"}</TableCell>
            <TableCell>{ticket.assigneeName ?? "Unassigned"}</TableCell>
            <TableCell>
              <Badge variant="outline">{ticket.channel}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={ticket.status === "open" ? "default" : "secondary"}>
                {ticket.status}
              </Badge>
            </TableCell>
            <TableCell>
              <LocalDateTime iso={ticket.createdAt.toISOString()} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Shows the best thing we know about the customer: name, then email, then phone.
function describeCustomer(ticket: TicketListItem): string {
  if (ticket.customerName) {
    return ticket.customerName;
  }
  if (ticket.customerEmail) {
    return ticket.customerEmail;
  }
  if (ticket.customerPhone) {
    return ticket.customerPhone;
  }
  return "Unknown";
}
