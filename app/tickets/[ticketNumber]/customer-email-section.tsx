"use client";

import { useActionState, useState } from "react";
import { setCustomerEmailAction } from "@/app/actions/tickets";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Who typed the email in and when, "came-with-ticket", or null when there is no email.
export type EmailOrigin = { setByName: string; setAtIso: string } | "came-with-ticket" | null;

type CustomerEmailSectionProps = {
  ticketId: string;
  customerEmail: string | null;
  origin: EmailOrigin;
};

// Shows the customer's email and lets anyone in the company add or change it.
// A wrong address would send the customer's details to a stranger, so the
// address is shown back for confirmation and only saved after "Yes, save".
// The page gives this component a key that changes on every save, so it
// starts again in "view" mode afterwards.
export function CustomerEmailSection({ ticketId, customerEmail, origin }: CustomerEmailSectionProps) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [typedEmail, setTypedEmail] = useState(customerEmail ?? "");
  const [errors, saveAction, isSaving] = useActionState(setCustomerEmailAction, undefined);
  // The same clean-up the server does, so the expert confirms exactly what gets saved.
  const addressToSave = typedEmail.trim().toLowerCase();
  const errorMessage = errors?.message ?? errors?.fieldErrors?.customerEmail?.[0];

  return (
    <section className="grid gap-3 rounded-lg border p-4">
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
              className="min-w-64"
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
