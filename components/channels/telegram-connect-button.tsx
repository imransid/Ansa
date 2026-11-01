"use client";

import { useActionState } from "react";
import type { ConnectTelegramState } from "@/app/actions/channels";
import { RefreshWhilePending } from "@/components/refresh-while-pending";
import { Button, buttonVariants } from "@/components/ui/button";

// "Connect Telegram" (step 48): asks the server for a one-time link to
// ansa's bot, then shows it. The page asks the server again every few
// seconds while the owner is in Telegram, so "Connected" shows up by itself.
// The stand-in (development without ansa's bot) connects at once instead.
export function TelegramConnectButton({
  action,
  label,
}: {
  action: (previous: ConnectTelegramState | undefined) => Promise<ConnectTelegramState>;
  label: string;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  if (state?.link) {
    return (
      <div className="grid gap-2">
        <a href={state.link} target="_blank" rel="noopener noreferrer" className={buttonVariants({ className: "justify-self-start" })}>
          Open Telegram
        </a>
        <p className="text-sm text-muted-foreground">
          The link works for 10 minutes. Once you&apos;ve added ansa in Telegram, this page shows &ldquo;Connected&rdquo; by itself (reload
          it if it doesn&apos;t).
        </p>
        <RefreshWhilePending isPending />
      </div>
    );
  }
  return (
    <form action={formAction} className="grid justify-items-start gap-2">
      <Button type="submit" disabled={isPending}>
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
