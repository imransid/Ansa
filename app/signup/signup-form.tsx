"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction } from "@/app/actions/auth";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  ACCOUNT_EMAIL_MAX_LENGTH,
  COMPANY_NAME_MAX_LENGTH,
  COMPANY_NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PERSON_NAME_MAX_LENGTH,
} from "@/lib/form-limits";

// After an error the action sends back what was typed (errors.values), so
// nothing is typed twice; the password is never sent back and stays empty.
export function SignupForm() {
  const [errors, formAction, isPending] = useActionState(
    signupAction,
    undefined,
  );

  return (
    <form action={formAction} className="grid gap-4">
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
      <FormField
        name="companyName"
        label="Company name"
        autoComplete="organization"
        defaultValue={errors?.values?.companyName}
        minLength={COMPANY_NAME_MIN_LENGTH}
        maxLength={COMPANY_NAME_MAX_LENGTH}
        errors={errors?.fieldErrors?.companyName}
      />
      <FormField
        name="name"
        label="Your name"
        autoComplete="name"
        defaultValue={errors?.values?.name}
        maxLength={PERSON_NAME_MAX_LENGTH}
        errors={errors?.fieldErrors?.name}
      />
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
        label={`Password (at least ${PASSWORD_MIN_LENGTH} characters)`}
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        errors={errors?.fieldErrors?.password}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating account..." : "Create account"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
