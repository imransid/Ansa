"use client";

import { useActionState } from "react";
import { addInboundAddressAction, addPhoneLineAction, removeInboundAddressAction, removePhoneLineAction } from "@/app/actions/setup";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

export function PhoneLineForm() {
  const [errors, action, isAdding] = useActionState(addPhoneLineAction, undefined);
  return (
    <form action={action} className="flex max-w-xl flex-wrap items-end gap-2">
      <FormField name="vapiPhoneNumberId" label="Vapi phone number id" errors={errors?.fieldErrors?.vapiPhoneNumberId} />
      <Button type="submit" disabled={isAdding}>
        {isAdding ? "Adding..." : "Add number"}
      </Button>
      <FormMessage message={errors?.message} />
    </form>
  );
}

export function InboundAddressForm() {
  const [errors, action, isAdding] = useActionState(addInboundAddressAction, undefined);
  return (
    <form action={action} className="flex max-w-xl flex-wrap items-end gap-2">
      <FormField name="address" label="Support address" type="email" errors={errors?.fieldErrors?.address} />
      <Button type="submit" disabled={isAdding}>
        {isAdding ? "Adding..." : "Add address"}
      </Button>
      <FormMessage message={errors?.message} />
    </form>
  );
}

type LinkedValuesProps = {
  kind: "phone" | "address";
  values: string[];
  canRemove: boolean;
};

// The company's phone numbers or support addresses, each with a Remove button for owners.
export function LinkedValues({ kind, values, canRemove }: LinkedValuesProps) {
  if (values.length === 0) {
    return <p className="text-sm text-muted-foreground">{kind === "phone" ? "No phone numbers yet." : "No support addresses yet."}</p>;
  }
  return (
    <ul className="grid max-w-xl gap-1 text-sm">
      {values.map((value) => (
        <LinkedValue key={value} kind={kind} value={value} canRemove={canRemove} />
      ))}
    </ul>
  );
}

function LinkedValue({ kind, value, canRemove }: { kind: "phone" | "address"; value: string; canRemove: boolean }) {
  const [errors, action, isRemoving] = useActionState(kind === "phone" ? removePhoneLineAction : removeInboundAddressAction, undefined);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{value}</span>
      {canRemove && (
        <form action={action}>
          <input type="hidden" name="value" value={value} />
          <Button type="submit" variant="ghost" size="sm" disabled={isRemoving} aria-label={`Remove ${value}`}>
            Remove
          </Button>
        </form>
      )}
      <FormMessage message={errors?.message} />
    </li>
  );
}

function FormMessage({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className="w-full text-sm text-destructive">
      {message}
    </p>
  );
}
