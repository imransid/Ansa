"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { createManualTicketAction } from "@/app/actions/tickets";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { normalizeEmailAddress } from "@/lib/email-address";
import type { FormErrors } from "@/lib/form-result";
import {
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_PHONE_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_SUBJECT_MAX_LENGTH,
} from "@/lib/ticket-limits";
import type { CategoryChoice } from "@/services/categories";

// "New ticket" (step 31). A customer email is saved only once the form has
// shown it back and the person said it is right ("Solved emails for this
// ticket will go to ... Correct?"), as everywhere a person enters one (step 9).
// On success the action opens the new ticket's page.
export function NewTicketForm({ categories }: { categories: CategoryChoice[] }) {
  // The address shown back for confirming, or null while filling in the form.
  const [addressToConfirm, setAddressToConfirm] = useState<string | null>(null);

  async function createTicket(previousErrors: FormErrors | undefined, formData: FormData) {
    const errors = await createManualTicketAction(previousErrors, formData);
    // A refused field is corrected in the form, so leave the confirm step.
    if (errors?.fieldErrors) {
      setAddressToConfirm(null);
    }
    return errors;
  }
  const [errors, createAction, isCreating] = useActionState(createTicket, undefined);

  // WHY by hand: when <form action> runs an action, React empties the form's
  // fields afterwards, and nothing typed may be lost to an error. An action
  // started here, in a transition, runs without that reset. (`action` stays
  // on the form so a click before the page has loaded sends nothing.)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const typedEmail = String(formData.get("customerEmail") ?? "").trim();
    if (typedEmail !== "" && addressToConfirm === null) {
      // Nothing is sent yet: first the address is shown back.
      setAddressToConfirm(normalizeEmailAddress(typedEmail));
      return;
    }
    if (addressToConfirm !== null) {
      formData.set("customerEmailConfirmed", "yes");
    }
    startTransition(() => createAction(formData));
  }

  const fieldErrors = errors?.fieldErrors;
  return (
    <form action={createAction} onSubmit={submit} className="grid max-w-xl gap-4">
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
      <FormField name="subject" label="Subject" autoComplete="off" maxLength={TICKET_SUBJECT_MAX_LENGTH} errors={fieldErrors?.subject} />
      <DescriptionField errors={fieldErrors?.description} />
      <CategoryField categories={categories} errors={fieldErrors?.categoryId} />
      <fieldset className="grid gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Customer (optional)</legend>
        <FormField
          name="customerName"
          label="Name"
          autoComplete="off"
          required={false}
          maxLength={CUSTOMER_NAME_MAX_LENGTH}
          errors={fieldErrors?.customerName}
        />
        <FormField
          name="customerEmail"
          label="Email"
          type="email"
          autoComplete="off"
          required={false}
          maxLength={CUSTOMER_EMAIL_MAX_LENGTH}
          readOnly={addressToConfirm !== null}
          errors={fieldErrors?.customerEmail}
        />
        <FormField
          name="customerPhone"
          label="Phone"
          type="tel"
          autoComplete="off"
          required={false}
          maxLength={CUSTOMER_PHONE_MAX_LENGTH}
          errors={fieldErrors?.customerPhone}
        />
      </fieldset>
      {addressToConfirm === null ? (
        <Button type="submit" className="justify-self-start" disabled={isCreating}>
          {isCreating ? "Creating..." : "Create ticket"}
        </Button>
      ) : (
        <ConfirmEmailStep address={addressToConfirm} isCreating={isCreating} onChangeAddress={() => setAddressToConfirm(null)} />
      )}
    </form>
  );
}

function DescriptionField({ errors }: { errors?: string[] }) {
  const errorMessage = errors?.[0];
  return (
    <div className="grid gap-2">
      <Label htmlFor="description">What the customer needs</Label>
      <Textarea
        id="description"
        name="description"
        required
        rows={6}
        maxLength={TICKET_DESCRIPTION_MAX_LENGTH}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={errorMessage ? "description-help description-error" : "description-help"}
      />
      <p id="description-help" className="text-xs text-muted-foreground">
        What they asked for, what was already tried, and anything promised to them.
      </p>
      {errorMessage && (
        <p id="description-error" role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

// The company's active categories. The ticket is routed by the one picked.
function CategoryField({ categories, errors }: { categories: CategoryChoice[]; errors?: string[] }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="categoryId">Category</Label>
      <NativeSelect id="categoryId" name="categoryId" defaultValue="" aria-describedby="categoryId-help">
        <option value="">No category</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </NativeSelect>
      <p id="categoryId-help" className="text-xs text-muted-foreground">
        Routing gives the ticket to whoever has this customer&apos;s other open ticket, or else to someone who
        handles its category. Without either, it waits under Unassigned.
      </p>
      {errors?.[0] && (
        <p role="alert" className="text-sm text-destructive">
          {errors[0]}
        </p>
      )}
    </div>
  );
}

type ConfirmEmailStepProps = {
  address: string;
  isCreating: boolean;
  onChangeAddress: () => void;
};

// Shows the cleaned-up address exactly as it will be saved.
function ConfirmEmailStep({ address, isCreating, onChangeAddress }: ConfirmEmailStepProps) {
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <p role="status" className="text-sm">
        Solved emails for this ticket will go to <strong className="text-base wrap-anywhere">{address}</strong>. Correct?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isCreating}>
          {isCreating ? "Creating..." : "Yes, create the ticket"}
        </Button>
        <Button type="button" variant="outline" disabled={isCreating} onClick={onChangeAddress}>
          No, change it
        </Button>
      </div>
    </div>
  );
}
