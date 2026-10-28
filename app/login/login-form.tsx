"use client";

import { useActionState, useSyncExternalStore } from "react";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { ACCOUNT_EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH } from "@/lib/form-limits";

export function LoginForm() {
  const [errors, formAction, isPending] = useActionState(
    loginAction,
    undefined,
  );
  // The page the person wanted before logging in (/login?next=...). Read in
  // the browser, so the page itself stays prerendered; the server checks it
  // is a path on this site before going there (lib/login-redirect.ts).
  const next = useSyncExternalStore(subscribeToNothing, readNextFromUrl, () => "");

  return (
    <form action={formAction} className="grid gap-4">
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
      <input type="hidden" name="next" value={next} />
      <FormField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={errors?.values?.email}
        maxLength={ACCOUNT_EMAIL_MAX_LENGTH}
        errors={errors?.fieldErrors?.email}
      />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX_LENGTH}
        errors={errors?.fieldErrors?.password}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Logging in..." : "Log in"}
      </Button>
      <p className="text-sm text-muted-foreground">
        <Link href="/forgot-password" className="underline">
          Forgot your password?
        </Link>
      </p>
      <p className="text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="underline">
          Create your company
        </Link>
      </p>
    </form>
  );
}

function readNextFromUrl(): string {
  return new URLSearchParams(window.location.search).get("next") ?? "";
}

// The URL doesn't change while the form is open.
function subscribeToNothing(): () => void {
  return () => {};
}
