"use client";

import { useActionState, useState } from "react";
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
  // For an action that takes a while (the AI writing): the button's words
  // meanwhile, and a line beside it once it worked, until it is pressed again.
  pendingLabel?: string;
  doneText?: string;
};

const LOOKS = {
  small: { variant: "outline", size: "sm", className: undefined },
  primary: { variant: "default", size: "lg", className: undefined },
  "on-green": { variant: "outline", size: "lg", className: "border-transparent bg-ivory text-sidebar hover:bg-white hover:text-sidebar focus-visible:ring-brass" },
} as const;

// One small button that runs an action at once (move a dish, switch it off
// for today), with its refusal next to it. Never for anything that deletes:
// that asks first (components/confirm-button.tsx).
export function ActionButton({ action, fields, label, accessibleLabel, look = "small", pendingLabel, doneText }: ActionButtonProps) {
  const [errors, formAction, isPending] = useActionState(action, undefined);
  // Pressed at least once: an answer without a refusal then means it worked
  // (the action answers undefined both before and after it worked).
  const [wasPressed, setWasPressed] = useState(false);
  const { variant, size, className } = LOOKS[look];
  const worked = wasPressed && !isPending && !errors?.message;
  return (
    <form action={formAction} onSubmit={() => setWasPressed(true)} className="inline-grid gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size={size} aria-label={accessibleLabel} disabled={isPending} className={className}>
        {isPending && pendingLabel ? pendingLabel : label}
      </Button>
      {errors?.message && (
        <span role="alert" className={look === "on-green" ? "text-xs text-ivory" : "text-xs text-destructive"}>
          {errors.message}
        </span>
      )}
      {doneText && (
        <span role="status" className="text-xs text-muted-foreground">
          {worked ? doneText : ""}
        </span>
      )}
    </form>
  );
}
