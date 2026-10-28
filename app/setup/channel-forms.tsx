"use client";

import { useActionState } from "react";
import { addInboundAddressAction, removeInboundAddressAction } from "@/app/actions/setup";
import { ConfirmButton } from "@/components/confirm-button";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { CUSTOMER_EMAIL_MAX_LENGTH } from "@/lib/ticket-limits";

// Keeps what was typed when the address is refused, clears it once added.
export function InboundAddressForm() {
  const [errors, action, isAdding] = useActionState(addInboundAddressAction, undefined);
  return (
    <form action={action} className="flex max-w-xl flex-wrap items-end gap-2">
      <FormField
        name="address"
        label="Support address"
        type="email"
        defaultValue={errors?.values?.address}
        maxLength={CUSTOMER_EMAIL_MAX_LENGTH}
        errors={errors?.fieldErrors?.address}
      />
      <Button type="submit" disabled={isAdding}>
        {isAdding ? "Adding..." : "Add address"}
      </Button>
      {errors?.message && (
        <p role="alert" className="w-full text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}

type SupportAddressListProps = {
  addresses: string[];
  canRemove: boolean;
};

// The addresses the company's customers write to, each with a Remove button
// for owners. Removing one asks first and says what changes: ansa uses the
// list to recognise the company's own mail (and its Google Group).
export function SupportAddressList({ addresses, canRemove }: SupportAddressListProps) {
  if (addresses.length === 0) {
    return <p className="text-sm text-muted-foreground">No support addresses listed yet.</p>;
  }
  return (
    <ul className="grid max-w-xl gap-2 text-sm">
      {addresses.map((address) => (
        <li key={address} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-mono wrap-anywhere">{address}</span>
          {canRemove && (
            <ConfirmButton
              action={removeInboundAddressAction}
              fields={{ value: address }}
              label="Remove"
              accessibleLabel={`Remove ${address}`}
              question={`Remove ${address}? ansa will no longer recognise it as yours: email from it can become tickets, and if it is a Google Group, the customer emails it passes on will be skipped as bulk mail.`}
              confirmLabel="Yes, remove"
              pendingLabel="Removing..."
            />
          )}
        </li>
      ))}
    </ul>
  );
}
