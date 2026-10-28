"use client";

import { useActionState, useState } from "react";
import { setCustomerEmailAction } from "@/app/actions/tickets";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeEmailAddress } from "@/lib/email-address";

// Who typed the email in and when, "came-with-ticket", or null when there is no email.
export type EmailOrigin = { setByName: string; setAtIso: string } | "came-with-ticket" | null;

// An address from the email this ticket came from that was NOT filled in on
// its own: its sender when not verified (step 25), its Reply-To, or a verified
// sender that asked for replies elsewhere (a contact form's relay, step 27).
export type SuggestedEmail = { address: string; kind: "unverified-sender" | "reply-to" | "sender-with-reply-to" };

type CustomerEmailSectionProps = {
  ticketId: string;
  customerEmail: string | null;
  origin: EmailOrigin;
  suggestions: SuggestedEmail[];
};

// Shows the customer's email and lets anyone in the company add or change it.
// A wrong address would send the customer's details to a stranger, so the
// address is shown back for confirmation and only saved after "Yes, save".
// The same goes for a suggested address: "Use this address" only fills it in
// for that confirmation. The page gives this component a key that changes on
// every save, so it starts again in "view" mode afterwards.
export function CustomerEmailSection({ ticketId, customerEmail, origin, suggestions }: CustomerEmailSectionProps) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [typedEmail, setTypedEmail] = useState(customerEmail ?? "");
  const [errors, saveAction, isSaving] = useActionState(setCustomerEmailAction, undefined);
  // The same clean-up the server does (an international domain written the
  // way mail servers need it), so the expert confirms exactly what gets saved.
  const addressToSave = normalizeEmailAddress(typedEmail);
  const errorMessage = errors?.message ?? errors?.fieldErrors?.customerEmail?.[0];

  return (
    // wrap-anywhere: a long address wraps on a phone instead of widening the page.
    <section className="grid min-w-0 gap-3 rounded-lg border p-4 wrap-anywhere">
      <h2 className="text-lg font-semibold">Customer email</h2>

      {mode === "view" && (
        <div className="flex flex-wrap items-center gap-3">
          {customerEmail ? (
            <p className="text-sm">
              <strong>{customerEmail}</strong>
              {origin === "came-with-ticket" && <span className="text-muted-foreground"> · came with the ticket</span>}
              {origin && origin !== "came-with-ticket" && (
                <span className="text-muted-foreground">
                  {" "}· entered by {origin.setByName} on <LocalDateTime iso={origin.setAtIso} />
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No customer email on file. The customer won&apos;t be emailed when this ticket is solved.
            </p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setMode("edit")}>
            {customerEmail ? "Change" : "Add email"}
          </Button>
        </div>
      )}

      {mode === "view" &&
        !customerEmail &&
        suggestions.map((suggestion) => (
          <div key={`${suggestion.kind}-${suggestion.address}`} className="grid gap-2">
            <p className="text-sm">
              <SuggestionText suggestion={suggestion} />
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setTypedEmail(suggestion.address);
                setMode("confirm");
              }}
            >
              Use this address
            </Button>
          </div>
        ))}

      {mode === "edit" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            // Nothing is saved yet: this only moves on to the confirm step.
            event.preventDefault();
            setMode("confirm");
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="customer-email">Customer&apos;s email</Label>
            <Input
              id="customer-email"
              type="email"
              required
              value={typedEmail}
              onChange={(event) => setTypedEmail(event.target.value)}
              className="w-72 max-w-full"
            />
          </div>
          <Button type="submit">Continue</Button>
          <Button type="button" variant="ghost" onClick={() => setMode("view")}>
            Cancel
          </Button>
        </form>
      )}

      {mode === "confirm" && (
        <div className="grid gap-3">
          <p className="text-sm">
            Solved emails for this ticket will go to <strong className="text-base">{addressToSave}</strong>. Correct?
          </p>
          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <form action={saveAction}>
              <input type="hidden" name="ticketId" value={ticketId} />
              <input type="hidden" name="customerEmail" value={addressToSave} />
              <input type="hidden" name="confirmed" value="yes" />
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Yes, save"}
              </Button>
            </form>
            <Button type="button" variant="outline" onClick={() => setMode("edit")}>
              No, edit
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// Why this address is only a suggestion.
function SuggestionText({ suggestion }: { suggestion: SuggestedEmail }) {
  const address = <strong>{suggestion.address}</strong>;
  if (suggestion.kind === "reply-to") {
    return (
      <>
        The email asks for replies to {address} (its Reply-To). Website contact forms put the customer&apos;s address
        there, but nobody checked it: use it only if you&apos;re sure it is the customer&apos;s.
      </>
    );
  }
  if (suggestion.kind === "sender-with-reply-to") {
    return (
      <>
        The email came from {address} (verified), but it asked for replies to a different address, so {address} may be
        a website form or another service rather than the customer.
      </>
    );
  }
  return (
    <>
      The email came from {address}, but that address is not verified: the email didn&apos;t pass the DKIM or DMARC
      checks, and anyone can write any address there. Use it only if you&apos;re sure it is the customer&apos;s.
    </>
  );
}
