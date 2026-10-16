"use client";

import { useActionState } from "react";
import { setReplyToEmailAction } from "@/app/actions/setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Not a FormField: that one is always required, and empty here means "clear it".
export function ReplyToForm({ current }: { current: string | null }) {
  const [errors, action, isSaving] = useActionState(setReplyToEmailAction, undefined);
  const message = errors?.message ?? errors?.fieldErrors?.replyToEmail?.[0];

  return (
    <form action={action} className="flex max-w-xl flex-wrap items-end gap-2">
      <div className="grid gap-2">
        <Label htmlFor="replyToEmail">Reply-to address</Label>
        <Input id="replyToEmail" name="replyToEmail" type="email" defaultValue={current ?? ""} className="w-72" />
      </div>
      <Button type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save"}
      </Button>
      {message && (
        <p role="alert" className="w-full text-sm text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
