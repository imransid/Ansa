"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormErrors } from "@/lib/form-result";

type ActionButtonProps = {
  action: (previous: FormErrors | undefined, formData: FormData) => Promise<FormErrors | undefined>;
  // The hidden fields the action reads (which dish, which way).
  fields: Record<string, string>;
  label: string;
  // Read by screen readers instead of label: what it acts on.
  accessibleLabel: string;
  // "small" (the default): an outline button beside other things. "primary":
  // the one thing to do on the page. "on-green": Home's status card, ivory
  // with a brass focus ring.
  look?: "small" | "primary" | "on-green";
};

const LOOKS = {
  small: { variant: "outline", size: "sm", className: undefined },
  primary: { variant: "default", size: "lg", className: undefined },
  "on-green": { variant: "outline", size: "lg", className: "border-transparent bg-ivory text-sidebar hover:bg-white hover:text-sidebar focus-visible:ring-brass" },
} as const;

// One small button that runs an action at once (move a dish, switch it off
// for today), with its refusal next to it. Never for anything that deletes:
// that asks first (components/confirm-button.tsx).
export function ActionButton({ action, fields, label, accessibleLabel, look = "small" }: ActionButtonProps) {
  const [errors, formAction, isPending] = useActionState(action, undefined);
  const { variant, size, className } = LOOKS[look];
  return (
    <form action={formAction} className="inline-grid gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size={size} aria-label={accessibleLabel} disabled={isPending} className={className}>
        {label}
      </Button>
      {errors?.message && (
        <span role="alert" className={look === "on-green" ? "text-xs text-ivory" : "text-xs text-destructive"}>
          {errors.message}
        </span>
      )}
    </form>
  );
}
