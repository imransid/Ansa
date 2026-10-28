"use client";

import { useActionState } from "react";
import { disableAutopublishRuleAction, enableAutopublishRuleAction } from "@/app/actions/publishing";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";

// Switching an auto-publish rule on (step 41) asks first, saying exactly
// what it does: posts going out without anyone approving each one.
export function EnableRuleButton({ ruleId, ruleLabel }: { ruleId: string; ruleLabel: string }) {
  return (
    <ConfirmButton
      action={enableAutopublishRuleAction}
      fields={{ ruleId }}
      label="Switch on..."
      accessibleLabel={`Switch on the rule for ${ruleLabel}`}
      question={`Posts for ${ruleLabel} will go out WITHOUT anyone approving each one. Only drafts that break none of the platform's rules, and whose every claim is backed by a confirmed fact, can go, and each is checked again when it goes out. Switch it on?`}
      confirmLabel="Yes, switch it on"
      pendingLabel="Switching on..."
    />
  );
}

// Switching a rule off is always safe: no confirm. Posts already scheduled
// under it won't go out (each is checked when it runs).
export function DisableRuleButton({ ruleId, ruleLabel }: { ruleId: string; ruleLabel: string }) {
  const [errors, formAction, isPending] = useActionState(disableAutopublishRuleAction, undefined);
  return (
    <form action={formAction} className="grid max-w-sm gap-1">
      <input type="hidden" name="ruleId" value={ruleId} />
      <Button type="submit" size="sm" variant="outline" className="justify-self-start" disabled={isPending} aria-label={`Switch off the rule for ${ruleLabel}`}>
        {isPending ? "Switching off..." : "Switch off"}
      </Button>
      {errors?.message && !isPending && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {errors.message}
        </p>
      )}
    </form>
  );
}
