import { connectStandInTelegramAction, disconnectTelegramAction, startTelegramConnectAction } from "@/app/actions/channels";
import { TelegramConnectButton } from "@/components/channels/telegram-connect-button";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot } from "@/components/status-dot";
import type { ConnectionsPage } from "@/lib/core-views/channels";
import { CONNECTION_STATUS_TEXT } from "@/lib/telegram";

// Settings → Connections → Telegram (step 48): the connected account and
// Disconnect, or how to connect one. Owners connect and disconnect, members read.
export function TelegramSection({ page }: { page: ConnectionsPage }) {
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
          Development: ansa&apos;s bot isn&apos;t set (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET in .env.core), so this connects
          a stand-in account. Bring a customer&apos;s message in with{" "}
          <code className="rounded bg-muted px-1">cd core &amp;&amp; make simulate-telegram OWNER=&lt;your email&gt; NAME=&quot;Customer name&quot; TEXT=&quot;Message&quot;</code>.
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
        <code className="rounded bg-muted px-1">cd core &amp;&amp; make simulate-telegram OWNER=&lt;your email&gt; NAME=&quot;Customer name&quot; TEXT=&quot;Message&quot;</code>.
        Replies are written to .dev-messages/.
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">Customers&apos; messages arrive in your Inbox, and you can reply from there.</p>;
}
