"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [errors, formAction, isPending] = useActionState(
    loginAction,
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
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        errors={errors?.fieldErrors?.email}
      />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        errors={errors?.fieldErrors?.password}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Logging in..." : "Log in"}
      </Button>
      <p className="text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="underline">
          Create your company
        </Link>
      </p>
    </form>
  );
}
