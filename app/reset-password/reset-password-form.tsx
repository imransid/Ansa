"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetPasswordAction } from "@/app/actions/auth";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/form-limits";
import type { FormErrors } from "@/lib/form-result";

const somethingWentWrong: FormErrors = { message: "Something went wrong. Reload the page to try again." };

type ResetFormState = {
  errors?: FormErrors;
  // The link removed an unconfirmed invitee's account instead of setting a
  // password (services/unconfirmed-invitees.ts).
  accountRemoved?: boolean;
};

// Asks for the new password and sends it with the token from the link.
// Nothing is sent when the page opens.
export function ResetPasswordForm() {
  const router = useRouter();

  async function resetPassword(_previousState: ResetFormState | null, formData: FormData): Promise<ResetFormState | null> {
    // window.location.hash is "#<token>". Only the browser can read it, so the
    // token never shows up in request logs.
    formData.set("token", window.location.hash.slice(1));
    try {
      const result = await resetPasswordAction(formData);
      if (!result.ok) {
        return { errors: result.errors };
      }
      if (result.outcome === "account-removed") {
        return { accountRemoved: true };
      }
    } catch {
      // The server could not be reached, or a new deploy replaced the action.
      return { errors: somethingWentWrong };
    }
    // A reset logs the account out everywhere, so the next step is logging in.
    router.replace("/login?reset=done");
    return null;
  }

  const [state, formAction, isPending] = useActionState(resetPassword, null);

  if (state?.accountRemoved) {
    return <AccountRemovedNote />;
  }

  return (
    <form action={formAction} className="grid gap-4">
      {state?.errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
      <FormField
        name="newPassword"
        label={`New password (at least ${PASSWORD_MIN_LENGTH} characters)`}
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        errors={state?.errors?.fieldErrors?.newPassword}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save new password"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Link expired?{" "}
        <Link href="/forgot-password" className="underline">
          Ask for a new one
        </Link>
        .
      </p>
    </form>
  );
}

function AccountRemovedNote() {
  return (
    <div role="status" className="grid gap-4 text-sm">
      <p>
        This address had joined a team through an invite but was never confirmed, so instead of saving a password we
        removed that account. Nobody can log in with it now.
      </p>
      <p>
        The address is free again: to join a team, ask its owner to invite this address, or{" "}
        <Link href="/signup" className="underline">
          create your own company
        </Link>
        .
      </p>
    </div>
  );
}
