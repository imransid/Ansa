"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type SolveControlsProps = {
  ticketId: string;
  ticketNumber: number;
  // The address "Mark as solved" emails, or null when the ticket has none.
  customerEmail: string | null;
  solveAction: (formData: FormData) => void;
  isSolving: boolean;
  closeAction: (formData: FormData) => void;
  isClosing: boolean;
};

// The buttons that close an open ticket. "Mark as solved" emails the
// customer, so with an address on file it first says exactly who gets the
// email, and only a second click solves. The form sends that address: the
// server solves only if the ticket still has it, and refuses an address added
// since the page loaded too. Without an address it emails nobody, so one click
// does it (sending "" for "the page showed no address").
// "Close without emailing" shows on every open ticket, address or not: only it
// records that the customer was left out on purpose (spam, "thanks" replies,
// duplicates, and forged senders, whose email tickets have no address).
// TicketActions gives this component a key that changes with the address, so
// a new address always needs a new confirmation.
export function SolveControls({
  ticketId,
  ticketNumber,
  customerEmail,
  solveAction,
  isSolving,
  closeAction,
  isClosing,
}: SolveControlsProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  if (customerEmail && isConfirming) {
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          This emails <strong className="text-base wrap-anywhere">{customerEmail}</strong> that request #{ticketNumber} is solved.
        </p>
        <div className="flex flex-wrap gap-2">
          <form action={solveAction}>
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="confirmedCustomerEmail" value={customerEmail} />
            <Button type="submit" disabled={isSolving}>
              {isSolving ? "Saving..." : "Yes, solve and email"}
            </Button>
          </form>
          <Button type="button" variant="outline" onClick={() => setIsConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {customerEmail ? (
          <Button type="button" onClick={() => setIsConfirming(true)}>
            Mark as solved
          </Button>
        ) : (
          <form action={solveAction}>
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="confirmedCustomerEmail" value="" />
            <Button type="submit" disabled={isSolving}>
              {isSolving ? "Saving..." : "Mark as solved"}
            </Button>
          </form>
        )}
        <form action={closeAction}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <Button type="submit" variant="outline" disabled={isClosing}>
            {isClosing ? "Closing..." : "Close without emailing"}
          </Button>
        </form>
      </div>
      <p className="text-sm text-muted-foreground">
        Close without emailing is for spam, thank-you replies and duplicates: the ticket is solved and the customer gets
        no email.
      </p>
    </div>
  );
}
