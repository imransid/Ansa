"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions/auth";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { ACCOUNT_EMAIL_MAX_LENGTH } from "@/lib/form-limits";
import { describeLinkLifetime, PASSWORD_RESET_LINK_SECONDS } from "@/lib/link-lifetimes";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordResetAction, undefined);

  // The same words whether or not the address has an account: this page must
  // never tell anyone who has one (services/password-reset.ts).
  if (state?.sent) {
    return (
      <div className="grid gap-3 text-sm">
        <p role="status">If an account exists for that address, we&apos;ve emailed a link to choose a new password.</p>
        <p className="text-muted-foreground">
          The link works once, for {describeLinkLifetime(PASSWORD_RESET_LINK_SECONDS)}. Nothing there? Check your spam folder.
        </p>
        <Link href="/login" className="underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      {state?.errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
      <FormField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={state?.errors?.values?.email}
        maxLength={ACCOUNT_EMAIL_MAX_LENGTH}
        errors={state?.errors?.fieldErrors?.email}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Sending..." : "Email me a link"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
