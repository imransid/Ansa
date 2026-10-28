"use client";

import { useActionState } from "react";
import {
  changeNameAction,
  changePasswordAction,
  signOutOtherDevicesAction,
  type AccountFormState,
} from "@/app/actions/account";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PERSON_NAME_MAX_LENGTH } from "@/lib/form-limits";

export function NameForm({ currentName }: { currentName: string }) {
  const [state, action, isSaving] = useActionState(changeNameAction, undefined);
  return (
    <form action={action} className="flex max-w-xl flex-wrap items-end gap-2">
      <FormField
        name="name"
        label="Name"
        autoComplete="name"
        // After an error: what was typed, not the saved name.
        defaultValue={state?.errors?.values?.name ?? currentName}
        maxLength={PERSON_NAME_MAX_LENGTH}
        errors={state?.errors?.fieldErrors?.name}
      />
      <Button type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save"}
      </Button>
      <FormMessage state={state} doneMessage="Saved." />
    </form>
  );
}

// On success the action redirects to /account?changed=password, and the page
// shows the note (see the action for why it redirects).
export function PasswordForm() {
  const [state, action, isSaving] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="grid max-w-sm gap-4">
      <FormField
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX_LENGTH}
        errors={state?.errors?.fieldErrors?.currentPassword}
      />
      <FormField
        name="newPassword"
        label={`New password (at least ${PASSWORD_MIN_LENGTH} characters)`}
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        errors={state?.errors?.fieldErrors?.newPassword}
      />
      <Button type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Change password"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function OtherDevicesForm() {
  const [state, action, isWorking] = useActionState<AccountFormState | undefined>(signOutOtherDevicesAction, undefined);
  return (
    <form action={action} className="flex max-w-xl flex-wrap items-center gap-2">
      <Button type="submit" variant="outline" disabled={isWorking}>
        {isWorking ? "Logging out..." : "Log out on all other devices"}
      </Button>
      <FormMessage state={state} doneMessage="Done: you are now logged in only here." />
    </form>
  );
}

function FormMessage({ state, doneMessage }: { state: AccountFormState | undefined; doneMessage?: string }) {
  if (state?.errors?.message) {
    return (
      <p role="alert" className="w-full text-sm text-destructive">
        {state.errors.message}
      </p>
    );
  }
  if (state?.done && doneMessage) {
    return (
      <p role="status" className="w-full text-sm">
        {doneMessage}
      </p>
    );
  }
  return null;
}
