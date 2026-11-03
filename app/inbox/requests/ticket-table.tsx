import Link from "next/link";
import { Mail, MessageCircle, PenLine, Phone, type LucideIcon } from "lucide-react";
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
import type { TicketListItem } from "@/lib/types/tickets";

// WHY a fixed layout: the table is exactly as wide as the page, whatever the
// subjects say. Long text is cut with "..." (the full text shows when the
// pointer rests on it, and on the ticket), so Status and Created never slide
// out of view on a laptop (step 29). Narrow screens hide the less important
// columns instead: phones keep #, Subject and Status.
export function TicketTable({ tickets }: { tickets: TicketListItem[] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">#</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead className="w-20">Status</TableHead>
          <TableHead className="hidden w-52 md:table-cell">Customer</TableHead>
          <TableHead className="hidden w-28 lg:table-cell">Category</TableHead>
          <TableHead className="hidden w-32 lg:table-cell">Assigned to</TableHead>
          <TableHead className="hidden w-32 lg:table-cell">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} />
        ))}
      </TableBody>
    </Table>
  );
}

function TicketRow({ ticket }: { ticket: TicketListItem }) {
  const customer = describeCustomer(ticket);
  const assignee = ticket.assigneeName ?? "Unassigned";
  // Two teammates can share a name: the email, on hover, tells them apart.
  const assigneeDetails = ticket.assigneeEmail ? `${assignee} (${ticket.assigneeEmail})` : assignee;
  return (
    <TableRow>
      <TableCell className="truncate font-medium">{ticket.ticketNumber}</TableCell>
      <TableCell>
        <Link href={`/tickets/${ticket.ticketNumber}`} title={ticket.subject} className="block truncate hover:underline">
          {ticket.subject}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant={ticket.status === "open" ? "default" : "secondary"}>{ticket.status}</Badge>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="flex min-w-0 items-center gap-1.5">
          <ChannelIcon channel={ticket.channel} />
          <span className="truncate" title={customer}>
            {customer}
          </span>
        </span>
      </TableCell>
      <TableCell className="hidden truncate lg:table-cell" title={ticket.category ?? undefined}>
        {ticket.category ?? "-"}
      </TableCell>
      <TableCell className="hidden truncate lg:table-cell" title={assigneeDetails}>
        {assignee}
      </TableCell>
      <TableCell className="hidden truncate lg:table-cell">
        <LocalDateTime iso={ticket.createdAt.toISOString()} dateOnly />
      </TableCell>
    </TableRow>
  );
}

const CHANNEL_NAMES: Record<TicketListItem["channel"], string> = {
  phone: "Phone",
  email: "Email",
  // Typed in by a teammate (step 31).
  manual: "Added by hand",
  // A chat the assistant handed to a person (step 49).
  chat: "Chat",
};

// WHY a Record: TypeScript then refuses a channel without an icon (chat
// requests, the most common kind, once showed none).
const CHANNEL_ICONS: Record<TicketListItem["channel"], LucideIcon> = {
  phone: Phone,
  email: Mail,
  manual: PenLine,
  chat: MessageCircle,
};

// The ticket's channel as a small icon, with its name for screen readers
// and on hover.
function ChannelIcon({ channel }: { channel: TicketListItem["channel"] }) {
  const name = CHANNEL_NAMES[channel];
  const Glyph = CHANNEL_ICONS[channel];
  return (
    <span title={name} className="shrink-0 text-muted-foreground">
      <Glyph aria-hidden className="size-3.5" />
      <span className="sr-only">{name}: </span>
    </span>
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
