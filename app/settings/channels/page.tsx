import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmailConnection, PhoneConnection, PostingPlatforms } from "@/components/channels/more-connections";
import { PageLoading } from "@/components/page-loading";
import { getAccountsPageFromCore } from "@/lib/core-views/accounts";
import { getConnectionsFromCore, type ConnectionsPage } from "@/lib/core-views/channels";
import { requireSessionContext } from "@/lib/session";
import type { PlatformView, SocialAccountsPage } from "@/lib/types/social-accounts";
import { MessengerFromCore } from "./messenger-from-core";
import { TelegramSection } from "./telegram-section";

export const metadata: Metadata = { title: "Connections - ansa" };

// Settings → Connections (step 48): where customers write to the restaurant.
// Telegram connects here; owners connect and disconnect, members read.
export default function ChannelsSettingsPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
          &larr; Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-muted-foreground">Everywhere ansa answers and posts for you, each with one button. Messages arrive in your Inbox.</p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <Channels />
      </Suspense>
    </main>
  );
}

async function Channels() {
  await requireSessionContext("/settings/channels");
  const page = await getConnectionsFromCore();
  // LinkedIn, X and YouTube (core's Accounts page), read only for a
  // business, the one that shows them.
  const social = page.kind === "business" ? await getAccountsPageFromCore() : null;
  return (
    <ConnectionsSections
      page={page}
      messenger={<MessengerFromCore messenger={page.messenger} canManage={page.canManage} personal={page.kind === "personal"} />}
      posting={social && <PostingPlatforms platforms={postingPlatformsOf(social)} canManage={social.canManage} />}
    />
  );
}

// LinkedIn, X and YouTube: where ansa can post besides Facebook.
function postingPlatformsOf(social: SocialAccountsPage): PlatformView[] {
  return social.platforms.filter((platform) => platform.platform !== "facebook");
}

// The page's sections, whichever backend read them.
function ConnectionsSections({ page, messenger, posting }: { page: ConnectionsPage; messenger: ReactNode; posting: ReactNode }) {
  return (
    <div className="grid gap-6">
      <section aria-labelledby="telegram-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="telegram-heading" className="text-lg font-semibold">
          Telegram
        </h2>
        <TelegramSection page={page} />
      </section>
      {messenger && (
        <section aria-labelledby="messenger-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
          <h2 id="messenger-heading" className="text-lg font-semibold">
            Facebook Messenger
          </h2>
          {messenger}
        </section>
      )}
      <section aria-labelledby="email-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="email-heading" className="text-lg font-semibold">
          Email
        </h2>
        <EmailConnection address={page.forwardingAddress} lastEmailAt={page.lastEmailAt} />
      </section>
      <section aria-labelledby="phone-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="phone-heading" className="text-lg font-semibold">
          Phone calls
        </h2>
        <PhoneConnection lines={page.phoneLines} />
      </section>
      {page.kind === "business" && posting && (
        <section aria-labelledby="posting-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
          <h2 id="posting-heading" className="text-lg font-semibold">
            Posts on other platforms
          </h2>
          <p className="text-sm text-muted-foreground">Where ansa can post besides your Facebook Page.</p>
          {posting}
        </section>
      )}
    </div>
  );
}
