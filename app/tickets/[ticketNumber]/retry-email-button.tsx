"use client";

import { useActionState, useState } from "react";
import { retryCustomerEmailAction } from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";

type RetryEmailButtonProps = {
  emailId: string;
  // The email was first tried more than 23 hours ago. Resend only recognises
  // a repeat for 24 hours, so it may already be in the customer's inbox:
  // ask before sending it again.
  mayAlreadyHaveBeenDelivered: boolean;
};

export function RetryEmailButton({ emailId, mayAlreadyHaveBeenDelivered }: RetryEmailButtonProps) {
  const [errors, retryAction, isRetrying] = useActionState(retryCustomerEmailAction, undefined);
  const [confirming, setConfirming] = useState(false);

  if (mayAlreadyHaveBeenDelivered && !confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Retry
      </Button>
    );
  }

  return (
    <form action={retryAction} className="grid gap-2">
      <input type="hidden" name="emailId" value={emailId} />
      {confirming && (
        <>
          <input type="hidden" name="confirmPossibleDuplicate" value="yes" />
          <p className="text-sm">
            This email was first tried more than a day ago and may already have reached the customer. Sending it
            again could email them twice. Send it anyway?
          </p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={isRetrying}>
          {isRetrying ? "Sending..." : confirming ? "Yes, send it again" : "Retry"}
        </Button>
        {confirming && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        )}
        {errors?.message && (
          <p role="alert" className="text-sm text-destructive">
            {errors.message}
          </p>
        )}
      </div>
    </form>
  );
}
