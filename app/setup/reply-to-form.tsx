"use client";

import { useActionState, useState } from "react";
import { setReplyToEmailAction } from "@/app/actions/setup";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CUSTOMER_EMAIL_MAX_LENGTH } from "@/lib/ticket-limits";

// Not a FormField: that one is always required, and empty here means "clear it".
// Says "Saved." when it worked, and keeps what was typed when it didn't.
export function ReplyToForm({ current }: { current: string | null }) {
  const [state, action, isSaving] = useActionState(setReplyToEmailAction, undefined);
  // "Saved." is about the address that was saved: typing again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const message = state?.errors?.message ?? state?.errors?.fieldErrors?.replyToEmail?.[0];

  return (
    <form
      action={action}
      onInput={() => setChangedSinceSave(true)}
      onSubmit={() => setChangedSinceSave(false)}
      className="flex max-w-xl flex-wrap items-end gap-2"
    >
      <div className="grid gap-2">
        <Label htmlFor="replyToEmail">Reply-to address</Label>
        <Input
          id="replyToEmail"
          name="replyToEmail"
          type="email"
          defaultValue={state?.errors?.values?.replyToEmail ?? current ?? ""}
          maxLength={CUSTOMER_EMAIL_MAX_LENGTH}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "replyToEmail-error" : undefined}
          className="w-72 max-w-full"
        />
      </div>
      <Button type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save"}
      </Button>
      <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />
      {message && (
        <p id="replyToEmail-error" role="alert" className="w-full text-sm text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
