import Link from "next/link";
import { ConciergeBell } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { sendErrorText, WRITTEN_IN, type ConversationChannel } from "@/lib/conversations";
import type { ConversationEntryView } from "@/lib/types/conversation-page";
import { cn } from "@/lib/utils";

// A conversation's entries in order (step 47), each voice its own: the
// customer on the left in grey, ansa in sage with its bell, a person in
// green with their name, so nobody wonders what was sent in their name
// (step 48: what the restaurant wrote in its own Telegram app says so).
// Calls and emails are links to their own pages, where their content is.
// `senderName`: who the customer (or, for a person's account, the contact) is, by name.
export function ConversationTimeline({ entries, senderName, channel }: { entries: ConversationEntryView[]; senderName: string; channel: ConversationChannel }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing here yet.</p>;
  }
  return (
    <ol className="grid gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className={cn("grid max-w-[85%] gap-1", entry.author === "customer" ? "justify-self-start" : "justify-self-end justify-items-end")}>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {entry.author === "assistant" && <ConciergeBell aria-hidden className="size-3.5 text-link" />}
            {describeAuthor(entry, senderName, channel)} · <LocalDateTime iso={entry.createdAt.toISOString()} />
          </span>
          <EntryBody entry={entry} />
          {entry.sendStatus && entry.sendStatus !== "sent" && (
            <span className={cn("text-xs", entry.sendStatus === "draft" || entry.sendStatus === "discarded" ? "text-muted-foreground" : "text-destructive")}>
              {describeDelivery(entry, channel)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function EntryBody({ entry }: { entry: ConversationEntryView }) {
  if (entry.call) {
    return (
      <p className="rounded-2xl border px-3 py-2 text-sm">
        Phone call{entry.call.aiOutcome === "solved" ? ", solved by ansa" : entry.call.aiOutcome === "needs_human" ? ", needs a person" : ""}.{" "}
        <Link href={`/calls/${entry.call.id}`} className="underline">
          Open the call
        </Link>
      </p>
    );
  }
  if (entry.email) {
    // The email's content shows on the request it became ("Original email").
    return (
      <p className="rounded-2xl border px-3 py-2 text-sm wrap-anywhere">
        Email: {entry.email.subject ?? "(no subject)"}
        {entry.email.ticketNumber !== null && (
          <>
            {" "}
            <Link href={`/tickets/${entry.email.ticketNumber}`} className="underline">
              Open the email (request #{entry.email.ticketNumber})
            </Link>
          </>
        )}
      </p>
    );
  }
  const style =
    entry.author === "customer"
      ? "bg-muted rounded-bl-md"
      : entry.author === "assistant"
        ? "bg-secondary rounded-br-md"
        : "bg-primary text-primary-foreground rounded-br-md";
  return (
    <p className={cn("rounded-2xl px-3 py-2 text-sm whitespace-pre-line", style, entry.sendStatus === "discarded" && "opacity-60 line-through")}>
      {entry.unreadable ? "(This message could not be decrypted.)" : entry.text}
    </p>
  );
}

function describeAuthor(entry: ConversationEntryView, senderName: string, channel: ConversationChannel): string {
  if (entry.author === "assistant") {
    return "ansa";
  }
  if (entry.author === "person") {
    return entry.authorName ?? "A teammate";
  }
  if (entry.author === "business_account") {
    return WRITTEN_IN[channel] ?? "Written in your own app";
  }
  return entry.call ? "Call" : entry.email ? "Email" : senderName;
}

function describeDelivery(entry: ConversationEntryView, channel: ConversationChannel): string {
  if (entry.sendStatus === "sending") {
    return "Sending...";
  }
  if (entry.sendStatus === "draft") {
    return "Waiting for you: not sent yet";
  }
  if (entry.sendStatus === "discarded") {
    return "Discarded: never sent";
  }
  if (entry.sendError) {
    return sendErrorText(entry.sendError, channel);
  }
  if (entry.sendStatus === "unclear") {
    return "Maybe not delivered: the channel didn't answer.";
  }
  return "Not sent: this channel isn't connected.";
}
