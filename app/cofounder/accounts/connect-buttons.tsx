"use client";

import { useActionState } from "react";
import { connectSocialAccountAction, connectStandInAccountAction } from "@/app/actions/social-accounts";
import { Button } from "@/components/ui/button";
import type { SocialPlatform } from "@/lib/social-platforms";

type ConnectButtonProps = {
  platform: SocialPlatform;
  // "Connect LinkedIn", "Reconnect", ...
  label: string;
  // Read by screen readers instead, when label alone doesn't say which account.
  accessibleLabel?: string;
  variant?: "default" | "outline";
};

// Connect (or Reconnect): the server saves the attempt, then sends the
// owner to the platform's own page; they come back to this page with what
// became of it. A refusal (the hourly limit, a platform not set up) stays
// next to the button.
export function ConnectButton({ platform, label, accessibleLabel, variant = "default" }: ConnectButtonProps) {
  const [errors, action, isOpening] = useActionState(connectSocialAccountAction, undefined);
  return (
    <form action={action} className="grid max-w-sm gap-1">
      <input type="hidden" name="platform" value={platform} />
      <Button type="submit" size="sm" variant={variant} className="justify-self-start" aria-label={accessibleLabel} disabled={isOpening}>
        {isOpening ? "Opening..." : label}
      </Button>
      {errors?.message && !isOpening && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {errors.message}
        </p>
      )}
    </form>
  );
}

// "Connect a stand-in account" (or Reconnect one): development only, it
// connects at once, without the platform.
export function StandInConnectButton({ platform, label, accessibleLabel }: Omit<ConnectButtonProps, "variant">) {
  const [errors, action, isConnecting] = useActionState(connectStandInAccountAction, undefined);
  return (
    <form action={action} className="grid max-w-sm gap-1">
      <input type="hidden" name="platform" value={platform} />
      <Button type="submit" size="sm" variant="outline" className="justify-self-start" aria-label={accessibleLabel} disabled={isConnecting}>
        {isConnecting ? "Connecting..." : label}
      </Button>
      {errors?.message && !isConnecting && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {errors.message}
        </p>
      )}
    </form>
  );
}
