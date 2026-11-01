import Link from "next/link";
import { connectSocialAccountAction, connectStandInAccountAction } from "@/app/actions/social-accounts";
import { ActionButton } from "@/components/action-button";
import { StatusDot } from "@/components/status-dot";
import { MESSAGING_SCOPES } from "@/lib/messenger";
import type { PlatformView } from "@/lib/types/social-accounts";

// Settings → Connections → Facebook Messenger (step 53): the company's
// Facebook Pages and whether their messages come to ansa, and one button
// to connect a Page (the same login as posts, step 40). Owners connect;
// members read.
export function MessengerSection({ facebook, canManage, personal }: { facebook: PlatformView; canManage: boolean; personal: boolean }) {
  const pages = facebook.connections.filter((page) => page.status !== "disconnected");
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        {personal
          ? "Messenger works with a Facebook Page. A personal Facebook profile can't be connected to any assistant: Meta doesn't allow it."
          : "Customers write to your Facebook Page as always; ansa answers in Messenger. The same login lets ansa post to the Page."}
      </p>
      {pages.length > 0 && (
        <ul className="divide-y border-y">
          {pages.map((page) => (
            <li key={page.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="font-medium">
                {page.displayName}
                {page.isStandIn ? " (development stand-in)" : ""}
              </span>
              {page.status !== "connected" ? (
                <StatusDot tone="attention">Connect it again</StatusDot>
              ) : page.isStandIn || MESSAGING_SCOPES.every((scope) => page.scopes.includes(scope)) ? (
                <StatusDot tone="success">Messages come to ansa</StatusDot>
              ) : (
                <StatusDot tone="attention">Connect it again and allow messages</StatusDot>
              )}
            </li>
          ))}
        </ul>
      )}
      {facebook.mode === "not-set-up" ? (
        <p className="text-sm text-muted-foreground">Not set up by ansa yet.</p>
      ) : canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          {facebook.mode === "real" ? (
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
