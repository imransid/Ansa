import Link from "next/link";
import { connectSocialAccountAction, connectStandInAccountAction, disconnectSocialAccountAction } from "@/app/actions/social-accounts";
import { ActionButton } from "@/components/action-button";
import { ConfirmButton } from "@/components/confirm-button";
import { StatusDot } from "@/components/status-dot";
import type { CoreMessenger } from "@/lib/core-views/channels";
import { OwnAnswersNote } from "./own-answers";
import { PracticeChatAdvice, StandInName } from "./stand-in";

type FacebookPage = CoreMessenger["pages"][number];

// Settings → Connections → Facebook Messenger, as core reads it
// (lib/core-views/channels.ts). Owners connect and disconnect a Page (the
// owner comes back here: "from"); members read.
export function MessengerFromCore({ messenger, canManage, personal }: { messenger: CoreMessenger; canManage: boolean; personal: boolean }) {
  if (!messenger.inPackage) {
    // Step 57: Messenger comes with the Business and Pro packages.
    return (
      <p className="text-sm text-muted-foreground">
        Facebook Messenger comes with the Business and Pro packages.{" "}
        <Link href="/billing" className="text-link hover:underline">
          See packages
        </Link>
      </p>
    );
  }
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
              {page.isStandIn ? <StandInName name="Facebook Page" /> : <span className="font-medium">{page.displayName}</span>}
              <span className="flex flex-wrap items-center gap-3">
                <PageStatus page={page} />
                {canManage && (
                  <ConfirmButton
                    action={disconnectSocialAccountAction}
                    fields={{ connectionId: page.id, from: "connections" }}
                    label="Disconnect"
                    accessibleLabel={`Disconnect ${page.isStandIn ? "the stand-in Facebook Page" : page.displayName}`}
                    question={disconnectQuestion(page)}
                    confirmLabel="Disconnect"
                    pendingLabel="Disconnecting..."
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {messenger.pages.some((page) => page.isStandIn) && <PracticeChatAdvice connected personal={personal} />}
      {canManage && messenger.mode === "stand-in" && messenger.pages.length === 0 && <PracticeChatAdvice connected={false} personal={personal} />}
      {messenger.pages.length > 0 && <OwnAnswersNote app="on your Facebook Page (Meta Business Suite)" personal={personal} />}
      {messenger.mode === "not-set-up" ? (
        <p className="text-sm text-muted-foreground">Not set up by ansa yet.</p>
      ) : canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          {messenger.mode === "real" ? (
            <ActionButton action={connectSocialAccountAction} fields={{ platform: "facebook" }} label="Connect Facebook Page" accessibleLabel="Connect a Facebook Page" look="primary" />
          ) : (
            // A stand-in is one Page: connecting it again would only save it again.
            messenger.pages.length === 0 && (
              <ActionButton
                action={connectStandInAccountAction}
                fields={{ platform: "facebook", from: "connections" }}
                label="Connect a stand-in Page"
                accessibleLabel="Connect a development stand-in Facebook Page"
              />
            )
          )}
          {/* The marketing pages are a business's (Settings → Social media posts). */}
          {!personal && (
            <Link href="/cofounder/accounts" className="text-sm underline">
              All social media accounts
            </Link>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">An owner connects the Page.</p>
      )}
    </div>
  );
}

function PageStatus({ page }: { page: FacebookPage }) {
  if (page.status !== "connected") {
    return <StatusDot tone="attention">Connect it again</StatusDot>;
  }
  if (!page.canMessage) {
    return <StatusDot tone="attention">Connect it again and allow messages</StatusDot>;
  }
  return <StatusDot tone="success">Messages come to ansa</StatusDot>;
}

// What a Page's Disconnect ends: its messages and its posts in ansa (one
// connection carries both). A real Page also keeps ansa in its settings.
function disconnectQuestion(page: FacebookPage): string {
  const name = page.isStandIn ? "the stand-in Facebook Page" : page.displayName;
  const facebook = page.isStandIn ? "" : " Posts already published stay on Facebook. To remove ansa from Facebook too, do it in your Facebook settings.";
  return `Disconnect ${name}? Its messages stop coming to ansa, and ansa can't post to it any more.${facebook}`;
}
