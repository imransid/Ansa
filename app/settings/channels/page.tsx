import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmailConnection, PhoneConnection, PostingPlatforms } from "@/components/channels/more-connections";
import { PageLoading } from "@/components/page-loading";
import { getAccountsPageFromCore } from "@/lib/core-views/accounts";
import { getConnectionsFromCore, type ConnectionsPage } from "@/lib/core-views/channels";
import { getPracticePhoneFromCore } from "@/lib/core-views/phone";
import { requireSessionContext } from "@/lib/session";
import type { PlatformView, SocialAccountsPage } from "@/lib/types/social-accounts";
import { MessengerFromCore } from "./messenger-from-core";
import { TelegramSection } from "./telegram-section";
import { WhatsAppSection } from "./whatsapp-section";

export const metadata: Metadata = { title: "Connections - ansa" };

// Settings → Connections (step 48): where customers write to the restaurant.
// WhatsApp (step 56) and Telegram connect here; owners connect and
// disconnect, members read.
export default function ChannelsSettingsPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
          &larr; Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-muted-foreground">Everywhere ansa answers for you, each with one button. Messages arrive in your Inbox.</p>
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
  const practice = await getPracticePhoneFromCore();
  return (
    <ConnectionsSections
      page={page}
      practicePhone={practice.available}
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
function ConnectionsSections({ page, practicePhone, messenger, posting }: { page: ConnectionsPage; practicePhone: boolean; messenger: ReactNode; posting: ReactNode }) {
  return (
    <div className="grid gap-6">
      {practicePhone && (
        <p className="rounded-2xl border border-dashed px-5 py-4 text-sm">
          Development: be {page.kind === "personal" ? "someone writing to you" : "one of your customers"} on this computer with the{" "}
          <Link href="/settings/channels/practice-chat" className="text-link hover:underline">
            practice chat
          </Link>{" "}
          (WhatsApp, Telegram or Messenger, through the stand-in accounts below, or an email to your forwarding address), or call with
          the practice phone (Phone calls). The
          emails ansa writes are in the{" "}
          <Link href="/settings/channels/mailbox" className="text-link hover:underline">
            development mailbox
          </Link>
          .
        </p>
      )}
      <section aria-labelledby="whatsapp-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="whatsapp-heading" className="text-lg font-semibold">
          WhatsApp
        </h2>
        <WhatsAppSection page={page} />
      </section>
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
        <EmailConnection address={page.forwardingAddress} lastEmailAt={page.lastEmailAt} personal={page.kind === "personal"} />
      </section>
      <section aria-labelledby="phone-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="phone-heading" className="text-lg font-semibold">
          Phone calls
        </h2>
        <PhoneConnection lines={page.phoneLines} />
        {practicePhone && (
          <p className="text-sm">
            Development: try a call on this computer with the{" "}
            {/* A full page load, not <Link>: the browser applies that page's
                own microphone rule (next.config.ts) only when it loads it. */}
            <a href="/settings/channels/practice-call" className="text-link hover:underline">
              practice phone
            </a>
            .
          </p>
        )}
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
