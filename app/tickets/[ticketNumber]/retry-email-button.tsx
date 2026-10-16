"use client";

import { useActionState } from "react";
import { retryCustomerEmailAction } from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";

export function RetryEmailButton({ emailId }: { emailId: string }) {
  const [errors, retryAction, isRetrying] = useActionState(
    retryCustomerEmailAction,
    undefined,
  );

  return (
    <form action={retryAction} className="flex items-center gap-3">
      <input type="hidden" name="emailId" value={emailId} />
      <Button type="submit" variant="outline" size="sm" disabled={isRetrying}>
        {isRetrying ? "Sending..." : "Retry"}
      </Button>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}
