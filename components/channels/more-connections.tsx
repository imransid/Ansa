import Link from "next/link";
import { connectSocialAccountAction, connectStandInAccountAction } from "@/app/actions/social-accounts";
import { ActionButton } from "@/components/action-button";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot } from "@/components/status-dot";
import type { PlatformView } from "@/lib/types/social-accounts";

// The rest of Settings → Connections (the "easy to use" pass, step 2 of
// the owner's journey): email forwarding, phone lines, and the other
// platforms ansa posts to, each with its one button. Owners connect;
// members read.

export function EmailConnection({ address, lastEmailAt }: { address: string; lastEmailAt: Date | null }) {
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-muted-foreground">Forward your business email to this address: every email arrives in your Inbox.</p>
      <code className="justify-self-start rounded-md bg-muted px-2 py-1 wrap-anywhere">{address}</code>
      {lastEmailAt ? (
        <StatusDot tone="success">
          Last email arrived <LocalDateTime iso={lastEmailAt.toISOString()} />
        </StatusDot>
      ) : (
        <StatusDot tone="quiet">No email has arrived yet</StatusDot>
      )}
      <Link href="/setup" className="justify-self-start underline">
        Email settings (reply-to address, your support addresses)
      </Link>
    </div>
  );
}

export function PhoneConnection({ lines }: { lines: { id: string; lastCallAt: Date | null }[] }) {
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">Coming soon: ansa answers your phone calls, and sends a message after a call you missed.</p>;
  }
  return (
    <ul className="divide-y border-y text-sm">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-wrap justify-between gap-2 py-2">
          <span>Phone line</span>
          {line.lastCallAt ? (
            <span className="text-muted-foreground">
              Last call <LocalDateTime iso={line.lastCallAt.toISOString()} />
            </span>
          ) : (
            <span className="text-muted-foreground">No call yet</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// LinkedIn, X and YouTube: where ansa can post besides Facebook.
export function PostingPlatforms({ platforms, canManage }: { platforms: PlatformView[]; canManage: boolean }) {
  return (
    <ul className="divide-y border-y">
      {platforms.map((platform) => {
        const live = platform.connections.filter((connection) => connection.status !== "disconnected");
        return (
          <li key={platform.platform} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span className="grid gap-0.5">
              <span className="font-medium">{platform.label}</span>
              {live.length > 0 ? (
                <StatusDot tone={live.every((connection) => connection.status === "connected") ? "success" : "attention"}>
                  {live.map((connection) => connection.displayName).join(", ")}
                </StatusDot>
              ) : (
                <span className="text-muted-foreground">{platform.mode === "not-set-up" ? "Not set up by ansa yet" : "Not connected"}</span>
              )}
            </span>
            {canManage && platform.mode !== "not-set-up" && (
              <ActionButton
                action={platform.mode === "real" ? connectSocialAccountAction : connectStandInAccountAction}
                fields={{ platform: platform.platform }}
                label={live.length > 0 ? "Connect another" : "Connect"}
                accessibleLabel={`Connect ${platform.label}`}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
