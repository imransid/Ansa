"use client";

import { useActionState, useEffect, useState } from "react";
import {
  getInvitePreviewAction,
  joinWithInviteAction,
} from "@/app/actions/invites";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { InvitePreview } from "@/services/invites";

type InviteLookup =
  | { status: "checking" }
  | { status: "not-usable" }
  | { status: "ready"; inviteToken: string; preview: InvitePreview };

export function JoinForm() {
  const [lookup, setLookup] = useState<InviteLookup>({ status: "checking" });

  useEffect(() => {
    // window.location.hash is "#<token>". Only the browser can read it.
    const inviteToken = window.location.hash.slice(1);
    getInvitePreviewAction(inviteToken).then((preview) => {
      if (preview) {
        setLookup({ status: "ready", inviteToken, preview });
      } else {
        setLookup({ status: "not-usable" });
      }
    });
  }, []);

  if (lookup.status === "checking") {
    return <p className="text-muted-foreground">Checking your invite...</p>;
  }

  if (lookup.status === "not-usable") {
    return (
      <p role="alert" className="text-sm text-destructive">
        This invite link has expired, was revoked, or was already used. Ask your
        team owner for a new one.
      </p>
    );
  }

  return <JoinDetailsForm inviteToken={lookup.inviteToken} preview={lookup.preview} />;
}

type JoinDetailsFormProps = {
  inviteToken: string;
  preview: InvitePreview;
};

function JoinDetailsForm({ inviteToken, preview }: JoinDetailsFormProps) {
  const [errors, formAction, isPending] = useActionState(
    joinWithInviteAction,
    undefined,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <p className="text-sm">
        You&apos;re invited to join <strong>{preview.companyName}</strong> as{" "}
        {preview.role === "owner" ? "an owner" : "a member"}.
      </p>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
      <input type="hidden" name="inviteToken" value={inviteToken} />
      {/* Locked to the invited email. The server checks it again anyway. */}
      <FormField
        name="email"
        label="Email"
        type="email"
        defaultValue={preview.email}
        readOnly
        errors={errors?.fieldErrors?.email}
      />
      <FormField
        name="name"
        label="Your name"
        autoComplete="name"
        errors={errors?.fieldErrors?.name}
      />
      <FormField
        name="password"
        label="Password (at least 12 characters)"
        type="password"
        autoComplete="new-password"
        errors={errors?.fieldErrors?.password}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Joining..." : "Join team"}
      </Button>
    </form>
  );
}
