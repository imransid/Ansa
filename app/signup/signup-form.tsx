"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction } from "@/app/actions/auth";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

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
        errors={errors?.fieldErrors?.companyName}
      />
      <FormField
        name="name"
        label="Your name"
        autoComplete="name"
        errors={errors?.fieldErrors?.name}
      />
      <FormField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        errors={errors?.fieldErrors?.email}
      />
      <FormField
        name="password"
        label="Password (at least 12 characters)"
        type="password"
        autoComplete="new-password"
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
