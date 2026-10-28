"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmEmailAction } from "@/app/actions/auth";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { PASSWORD_MAX_LENGTH } from "@/lib/form-limits";

const somethingWentWrongMessage = "Something went wrong. Reload the page to try again.";

// Asks for the account's password and sends it with the token from the link.
// Nothing is sent when the page opens: a link alone must never confirm an
// address or log anyone in (see services/auth.ts, confirmEmailWithPassword).
export function VerifyEmail() {
  const router = useRouter();

  async function confirmEmail(_previousError: string | null, formData: FormData): Promise<string | null> {
    // window.location.hash is "#<token>". Only the browser can read it, so the
    // token never shows up in request logs.
    formData.set("token", window.location.hash.slice(1));
    try {
      const result = await confirmEmailAction(formData);
      if (!result.ok) {
        return result.errors.message ?? somethingWentWrongMessage;
      }
    } catch {
      // The server could not be reached, or a new deploy replaced the action.
      return somethingWentWrongMessage;
    }
    // Confirming also logged the user in.
    router.replace("/dashboard");
    return null;
  }

  const [errorMessage, formAction, isPending] = useActionState(confirmEmail, null);

  return (
    <form action={formAction} className="grid gap-4">
      <p className="text-sm">Enter your password to confirm your email address.</p>
      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
      <FormField name="password" label="Password" type="password" autoComplete="current-password" maxLength={PASSWORD_MAX_LENGTH} />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Confirming..." : "Confirm email address"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Link expired?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>{" "}
        and we&apos;ll send you a new one.
      </p>
      <p className="text-sm text-muted-foreground">
        Don&apos;t know the password, or someone else signed up with your address?{" "}
        <Link href="/forgot-password" className="underline">
          Reset the password
        </Link>
        . The reset page then tells you what to do next.
      </p>
    </form>
  );
}
