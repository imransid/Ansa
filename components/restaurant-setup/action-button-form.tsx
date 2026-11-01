"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { SaveState } from "@/lib/form-result";

// A form that is only its button (setup's "Continue" past the channels, and
// "Open ansa" at the end), with the refusal next to it if the action says no.
export function ActionButtonForm({ action, label }: { action: (previous: SaveState | undefined) => Promise<SaveState>; label: string }) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid justify-items-start gap-2">
      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? "One moment..." : label}
      </Button>
      {state?.errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
    </form>
  );
}
