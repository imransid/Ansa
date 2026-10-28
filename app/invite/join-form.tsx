"use client";

import { useActionState, useEffect, useState } from "react";
import {
  getInvitePreviewAction,
  joinWithInviteAction,
} from "@/app/actions/invites";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PERSON_NAME_MAX_LENGTH } from "@/lib/form-limits";
import type { InvitePreview } from "@/services/invites";

type InviteLookup =
  | { status: "checking" }
  | { status: "not-usable" }
  | { status: "rate-limited" }
  | { status: "failed" }
  | { status: "ready"; inviteToken: string; preview: InvitePreview };

// What the page says instead of the form when the invite can't be shown.
const lookupProblemMessages = {
  "not-usable": "This invite link has expired, was revoked, or was already used. Ask your team owner for a new one.",
  "rate-limited": "Too many invite links were opened from your network. Try again in 15 minutes.",
  failed: "Something went wrong. Reload the page to try again.",
};

export function JoinForm() {
  const [lookup, setLookup] = useState<InviteLookup>({ status: "checking" });

  useEffect(() => {
    // window.location.hash is "#<token>". Only the browser can read it.
    const inviteToken = window.location.hash.slice(1);
    getInvitePreviewAction(inviteToken)
      .then((result) => {
        if (result.status === "ready") {
          setLookup({ status: "ready", inviteToken, preview: result.preview });
        } else {
          setLookup({ status: result.status });
        }
      })
      .catch(() => {
        // The server could not be reached, or a new deploy replaced the action.
        setLookup({ status: "failed" });
      });
  }, []);

  if (lookup.status === "checking") {
    return <p className="text-muted-foreground">Checking your invite...</p>;
  }

  if (lookup.status !== "ready") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {lookupProblemMessages[lookup.status]}
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
      <p className="text-sm text-muted-foreground">
        One email address can belong to one company.
      </p>
      {/* After an error the action sends back the name (never the password). */}
      <FormField
        name="name"
        label="Your name"
        autoComplete="name"
        defaultValue={errors?.values?.name}
        maxLength={PERSON_NAME_MAX_LENGTH}
        errors={errors?.fieldErrors?.name}
      />
      <FormField
        name="password"
        label={`Password (at least ${PASSWORD_MIN_LENGTH} characters)`}
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        errors={errors?.fieldErrors?.password}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Joining..." : "Join team"}
      </Button>
    </form>
  );
}
