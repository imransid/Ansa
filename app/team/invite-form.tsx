"use client";

import { useActionState, useState } from "react";
import { createInviteAction } from "@/app/actions/invites";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ACCOUNT_EMAIL_MAX_LENGTH } from "@/lib/form-limits";
import { MEMBER_ROLE_DESCRIPTION, OWNER_ONLY_CONTROLS } from "@/lib/team-roles";

// After an error the action sends back the address and the role picked, so a
// refused owner invite doesn't quietly turn back into a member invite.
export function InviteForm() {
  const [state, formAction, isPending] = useActionState(
    createInviteAction,
    undefined,
  );
  const typed = state?.errors?.values;
  const shownRole = typed?.role === "owner" ? "owner" : "member";

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
          defaultValue={typed?.email}
          maxLength={ACCOUNT_EMAIL_MAX_LENGTH}
          errors={state?.errors?.fieldErrors?.email}
        />
        <div className="grid gap-2">
          <Label htmlFor="role">Role</Label>
          {/* key: React reads a select's defaultValue only when it first
              renders, and empties the form after the action. A new key builds
              the menu again with the role sent back, so that is what stays. */}
          <NativeSelect
            key={shownRole}
            id="role"
            name="role"
            defaultValue={shownRole}
            aria-describedby="role-description"
          >
            <option value="member">Member</option>
            <option value="owner">Owner (full control)</option>
          </NativeSelect>
          <p id="role-description" className="text-sm text-muted-foreground">
            {MEMBER_ROLE_DESCRIPTION} Owners also control {OWNER_ONLY_CONTROLS}. You can change a role later on this page.
          </p>
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating link..." : "Create invite link"}
        </Button>
      </form>
      {/* key: each new link gets a fresh box, so "Copied" never refers to an older link. */}
      {state?.inviteLink && <InviteLinkBox key={state.inviteLink} inviteLink={state.inviteLink} />}
    </div>
  );
}

// Shows a new invite link once. We only store a hash, so it can't be shown again.
function InviteLinkBox({ inviteLink }: { inviteLink: string }) {
  const [copyStatus, setCopyStatus] = useState<"not-copied" | "copied" | "failed">("not-copied");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyStatus("copied");
    } catch {
      // Browsers can refuse clipboard access (permissions, plain http).
      setCopyStatus("failed");
    }
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
          {copyStatus === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      {copyStatus === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          Copy failed: select the link and copy it yourself.
        </p>
      )}
    </div>
  );
}
