import Link from "next/link";
import { connectSocialAccountAction, connectStandInAccountAction } from "@/app/actions/social-accounts";
import { ActionButton } from "@/components/action-button";
import { StatusDot } from "@/components/status-dot";
import type { CoreMessenger } from "@/lib/core-views/channels";

// Settings → Connections → Facebook Messenger, as core reads it
// (lib/core-views/channels.ts). Owners connect; members read.
export function MessengerFromCore({ messenger, canManage, personal }: { messenger: CoreMessenger; canManage: boolean; personal: boolean }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        {personal
          ? "Messenger works with a Facebook Page. A personal Facebook profile can't be connected to any assistant: Meta doesn't allow it."
          : "Customers write to your Facebook Page as always; ansa answers in Messenger. The same login lets ansa post to the Page."}
      </p>
      {messenger.pages.length > 0 && (
        <ul className="divide-y border-y">
          {messenger.pages.map((page) => (
            <li key={page.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="font-medium">
                {page.displayName}
                {page.isStandIn ? " (development stand-in)" : ""}
              </span>
              {page.status !== "connected" ? (
                <StatusDot tone="attention">Connect it again</StatusDot>
              ) : page.canMessage ? (
                <StatusDot tone="success">Messages come to ansa</StatusDot>
              ) : (
                <StatusDot tone="attention">Connect it again and allow messages</StatusDot>
              )}
            </li>
          ))}
        </ul>
      )}
      {messenger.mode === "not-set-up" ? (
        <p className="text-sm text-muted-foreground">Not set up by ansa yet.</p>
      ) : canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          {messenger.mode === "real" ? (
            <ActionButton action={connectSocialAccountAction} fields={{ platform: "facebook" }} label="Connect Facebook Page" accessibleLabel="Connect a Facebook Page" look="primary" />
          ) : (
            <ActionButton
              action={connectStandInAccountAction}
              fields={{ platform: "facebook" }}
              label="Connect a stand-in Page"
              accessibleLabel="Connect a development stand-in Facebook Page"
            />
          )}
          <Link href="/cofounder/accounts" className="text-sm underline">
            All social media accounts
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">An owner connects the Page.</p>
      )}
    </div>
  );
}
