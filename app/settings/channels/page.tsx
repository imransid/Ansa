import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connectStandInTelegramAction, disconnectTelegramAction, startTelegramConnectAction } from "@/app/actions/channels";
import { EmailConnection, PhoneConnection, PostingPlatforms } from "@/components/channels/more-connections";
import { MessengerSection } from "@/components/channels/messenger-section";
import { TelegramConnectButton } from "@/components/channels/telegram-connect-button";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDateTime } from "@/components/local-date-time";
import { PageLoading } from "@/components/page-loading";
import { StatusDot } from "@/components/status-dot";
import { requireSessionContext } from "@/lib/session";
import { CONNECTION_STATUS_TEXT } from "@/lib/telegram";
import { getSetupStateForSession } from "@/services/assistant-settings";
import { getSetupForSession } from "@/services/setup";
import { getSocialAccountsPageForSession } from "@/services/social-accounts";
import { getChannelsPageForSession, type ChannelsPage } from "@/services/telegram-connect";

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
  const session = await requireSessionContext("/settings/channels");
  const [page, social, setup, mail] = await Promise.all([
    getChannelsPageForSession(session),
    getSocialAccountsPageForSession(session),
    getSetupStateForSession(session),
    getSetupForSession(session),
  ]);
  const facebook = social.platforms.find((platform) => platform.platform === "facebook");
  const otherPlatforms = social.platforms.filter((platform) => platform.platform !== "facebook");
  return (
    <div className="grid gap-6">
      <section aria-labelledby="telegram-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="telegram-heading" className="text-lg font-semibold">
          Telegram
        </h2>
        <TelegramSection page={page} />
      </section>
      {facebook && (
        <section aria-labelledby="messenger-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
          <h2 id="messenger-heading" className="text-lg font-semibold">
            Facebook Messenger
          </h2>
          <MessengerSection facebook={facebook} canManage={social.canManage} personal={setup.kind === "personal"} />
        </section>
      )}
      <section aria-labelledby="email-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="email-heading" className="text-lg font-semibold">
          Email
        </h2>
        <EmailConnection address={mail.forwardingAddress} lastEmailAt={mail.lastInboundEmail?.receivedAt ?? null} />
      </section>
      <section aria-labelledby="phone-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="phone-heading" className="text-lg font-semibold">
          Phone calls
        </h2>
        <PhoneConnection lines={mail.phoneLines.map((line) => ({ id: line.vapiPhoneNumberId, lastCallAt: line.lastCallAt }))} />
      </section>
      {setup.kind === "business" && (
        <section aria-labelledby="posting-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
          <h2 id="posting-heading" className="text-lg font-semibold">
            Posts on other platforms
          </h2>
          <p className="text-sm text-muted-foreground">Where ansa can post besides your Facebook Page.</p>
          <PostingPlatforms platforms={otherPlatforms} canManage={social.canManage} />
        </section>
      )}
    </div>
  );
}

function TelegramSection({ page }: { page: ChannelsPage }) {
  const { telegram } = page;
  if (telegram) {
    return (
      <div className="grid gap-3">
        <StatusDot tone={telegram.status === "connected" ? "success" : "attention"}>{CONNECTION_STATUS_TEXT[telegram.status]}</StatusDot>
        <p className="text-sm">
          <span className="font-medium">{telegram.displayName}</span>
          {telegram.isStandIn ? " (development stand-in)" : ""}, since <LocalDateTime iso={telegram.connectedAt.toISOString()} />
        </p>
        <ConnectionAdvice status={telegram.status} isStandIn={telegram.isStandIn} />
        {page.canManage && (
          <ConfirmButton
            action={disconnectTelegramAction}
            fields={{}}
            label="Disconnect"
            accessibleLabel="Disconnect Telegram"
            question="Disconnect Telegram? Customers' messages stop arriving in ansa, and ansa stops replying. To remove ansa from Telegram too, open Telegram Business → Chatbots."
            confirmLabel="Disconnect"
            pendingLabel="Disconnecting..."
          />
        )}
      </div>
    );
  }
  if (page.telegramMode === "not-set-up") {
    return <p className="text-sm text-muted-foreground">Telegram isn&apos;t set up by ansa yet.</p>;
  }
  if (!page.canManage) {
    return <p className="text-sm text-muted-foreground">Not connected. An owner connects Telegram here.</p>;
  }
  if (page.telegramMode === "stand-in") {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Development: ansa&apos;s bot isn&apos;t set (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET), so this connects
          a stand-in account. Bring a customer&apos;s message in with{" "}
          <code className="rounded bg-muted px-1">pnpm simulate:telegram &lt;your email&gt; &quot;Customer name&quot; &quot;Message&quot;</code>.
        </p>
        <TelegramConnectButton action={connectStandInTelegramAction} label="Connect a stand-in Telegram account" />
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <ol className="grid list-decimal gap-1 pl-5 text-sm">
        <li>Press Connect Telegram, then Open Telegram, and press Start in ansa&apos;s chat.</li>
        <li>In Telegram, open Settings → Telegram Business → Chatbots and add ansa&apos;s bot.</li>
        <li>Choose the chats ansa may answer, and allow it to reply.</li>
      </ol>
      <p className="text-sm text-muted-foreground">
        Telegram may ask for Telegram Premium to add a chatbot. Customers&apos; messages are read by ansa&apos;s AI once the assistant
        answers on its own.
      </p>
      <TelegramConnectButton action={startTelegramConnectAction} label="Connect Telegram" />
    </div>
  );
}

function ConnectionAdvice({ status, isStandIn }: { status: "connected" | "cannot_reply" | "removed_in_telegram"; isStandIn: boolean }) {
  if (status === "cannot_reply") {
    return (
      <p className="text-sm text-muted-foreground">
        Messages arrive, but replies can&apos;t go. In Telegram, open Settings → Telegram Business → Chatbots and allow ansa to reply.
      </p>
    );
  }
  if (status === "removed_in_telegram") {
    return (
      <p className="text-sm text-muted-foreground">
        ansa was removed in Telegram, so no messages arrive. Add it back under Telegram Business → Chatbots, or disconnect here to connect
        another account.
      </p>
    );
  }
  if (isStandIn) {
    return (
      <p className="text-sm text-muted-foreground">
        Bring a customer&apos;s message in with{" "}
        <code className="rounded bg-muted px-1">pnpm simulate:telegram &lt;your email&gt; &quot;Customer name&quot; &quot;Message&quot;</code>.
        Replies are written to .dev-messages/.
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">Customers&apos; messages arrive in your Inbox, and you can reply from there.</p>;
}
