import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { describeIgnoredReason, PROCESS_AGAIN_REASONS, TICKET_ANYWAY_REASONS } from "@/lib/inbound-email-reasons";
import type { SetupOverview } from "@/services/setup";
import { InboundAddressForm, SupportAddressList } from "./channel-forms";
import { CopyButton } from "./copy-button";

type LastEmail = NonNullable<SetupOverview["lastInboundEmail"]>;

// How customer email reaches ansa: the company's forwarding address (made by
// ansa, never typed), when the last email arrived, and the addresses the
// company's customers write to.
export function EmailSection({ setup, isOwner }: { setup: SetupOverview; isOwner: boolean }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Customer emails</h2>
      <p className="text-sm text-muted-foreground">
        Forward your support mailbox (for example support@yourcompany.com) to this address. Customer emails that reach
        it become tickets here (automatic replies and bulk mail are skipped, and listed on the{" "}
        <Link href="/emails" className="underline">
          Emails page
        </Link>
        ).
      </p>
      <div className="flex max-w-3xl flex-wrap items-center gap-2">
        <code className="select-all break-all rounded-md border bg-muted px-3 py-2 text-sm">{setup.forwardingAddress}</code>
        <CopyButton text={setup.forwardingAddress} label="Copy the forwarding address" />
      </div>
      <p className="text-sm text-muted-foreground">
        Gmail sends a confirmation email first. It becomes a ticket here: open it and click its link (or enter its code
        in Gmail). Forwarding starts only then. To test it, send an email to your support address from another address:
        it should show up below. If nothing arrives, or Gmail&apos;s confirmation did not become a ticket, contact ansa.
      </p>
      <p className="text-sm text-muted-foreground">
        ansa made this address for your company only; nobody can choose it. If it ever gets spam, ansa can give you a
        new one.
      </p>
      <LastEmailReceived lastEmail={setup.lastInboundEmail} />

      <h3 className="font-medium">Addresses your customers write to</h3>
      <p className="text-sm text-muted-foreground">
        For your team&apos;s reference. Email sent from these addresses doesn&apos;t become a ticket on its own, so a
        mailbox can&apos;t loop into ansa: the Emails page lists it, and you can still make it a ticket there. If one of
        them is a Google Group, the customer emails it passes on still become tickets, as long as the customer&apos;s
        address is in From or Reply-To. Email only reaches ansa through the forwarding address above.
      </p>
      <SupportAddressList addresses={setup.inboundAddresses} canRemove={isOwner} />
      {isOwner && <InboundAddressForm />}
    </section>
  );
}

function LastEmailReceived({ lastEmail }: { lastEmail: SetupOverview["lastInboundEmail"] }) {
  if (!lastEmail) {
    return <p className="text-sm">Last email received: none yet.</p>;
  }
  return (
    <p className="text-sm">
      Last email received: <LocalDateTime iso={lastEmail.receivedAt.toISOString()} />. <WhatHappened lastEmail={lastEmail} />
    </p>
  );
}

function WhatHappened({ lastEmail }: { lastEmail: LastEmail }) {
  if (lastEmail.ticketNumber !== null) {
    return (
      <>
        It became{" "}
        <Link href={`/tickets/${lastEmail.ticketNumber}`} className="underline">
          ticket #{lastEmail.ticketNumber}
        </Link>
        .
      </>
    );
  }
  if (lastEmail.status === "ignored") {
    return (
      <>
        It did not become a ticket: {describeIgnoredReason(lastEmail.ignoredReason)}.{" "}
        <Link href="/emails" className="underline">
          See all emails
        </Link>
        <WhatCanBeDone reason={lastEmail.ignoredReason ?? ""} />.
      </>
    );
  }
  // Same rule as the Emails page, which offers "Process again".
  if (lastEmail.stuck) {
    return (
      <>
        It is stuck: its processing never finished.{" "}
        <Link href="/emails" className="underline">
          Process it again on the Emails page
        </Link>
        .
      </>
    );
  }
  return <>It is being turned into a ticket.</>;
}

// Only what the Emails page really offers for this reason: nothing for a mail
// loop (own_address).
function WhatCanBeDone({ reason }: { reason: string }) {
  if (TICKET_ANYWAY_REASONS.includes(reason)) {
    return <>, where you can still make it a ticket</>;
  }
  if (PROCESS_AGAIN_REASONS.includes(reason)) {
    return <>, where you can process it again</>;
  }
  return null;
}
