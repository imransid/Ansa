"use client";

import { useActionState, useState } from "react";
import { createInviteAction } from "@/app/actions/invites";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteForm() {
  const [state, formAction, isPending] = useActionState(
    createInviteAction,
    undefined,
  );

  return (
    <div className="grid max-w-md gap-4">
      <form action={formAction} className="grid gap-4">
        {state?.errors?.message && (
          <p role="alert" className="text-sm text-destructive">
            {state.errors.message}
          </p>
        )}
        <FormField
          name="email"
          label="Teammate's email"
          type="email"
          autoComplete="off"
          errors={state?.errors?.fieldErrors?.email}
        />
        <div className="grid gap-2">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            name="role"
            defaultValue="member"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="member">Member</option>
            <option value="owner">Owner (can manage invites)</option>
          </select>
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating link..." : "Create invite link"}
        </Button>
      </form>
      {state?.inviteLink && <InviteLinkBox inviteLink={state.inviteLink} />}
    </div>
  );
}

// Shows a new invite link once. We only store a hash, so it can't be shown again.
function InviteLinkBox({ inviteLink }: { inviteLink: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
  }

  return (
    <div className="grid gap-2 rounded-lg border p-4">
      <Label htmlFor="invite-link">
        Send this link to your teammate. It works once and expires in 7 days.
        You won&apos;t be able to see it again.
      </Label>
      <div className="flex gap-2">
        <Input id="invite-link" value={inviteLink} readOnly />
        <Button type="button" variant="outline" onClick={copyLink}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
