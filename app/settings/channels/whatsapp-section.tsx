import { connectStandInWhatsAppAction, disconnectWhatsAppAction } from "@/app/actions/channels";
import { TelegramConnectButton } from "@/components/channels/telegram-connect-button";
import { WhatsAppSignupButton } from "@/components/channels/whatsapp-signup-button";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot } from "@/components/status-dot";
import type { ConnectionsPage } from "@/lib/core-views/channels";
import { OwnAnswersNote } from "./own-answers";
import { PracticeChatAdvice, StandInName } from "./stand-in";

const IN_THE_APP = "in the WhatsApp Business app";

// Settings → Connections → WhatsApp (step 56): the connected number and
// Disconnect, or Meta's sign-up to connect one. Owners connect and
// disconnect, members read.
export function WhatsAppSection({ page }: { page: ConnectionsPage }) {
  const { whatsapp } = page;
  const personal = page.kind === "personal";
  if (whatsapp) {
    return (
      <div className="grid gap-3">
        <StatusDot tone={whatsapp.status === "connected" ? "success" : "attention"}>
          {whatsapp.status === "connected" ? "Connected" : "Removed on WhatsApp's side"}
        </StatusDot>
        <p className="text-sm">
          {whatsapp.isStandIn ? (
            <StandInName name={whatsapp.displayPhoneNumber} />
          ) : (
            <>
              <span className="font-medium">{whatsapp.displayPhoneNumber}</span>
              {whatsapp.verifiedName ? ` (${whatsapp.verifiedName})` : ""}
            </>
          )}
          , since <LocalDateTime iso={whatsapp.connectedAt.toISOString()} />
        </p>
        <NumberAdvice number={whatsapp} personal={personal} />
        {page.canManage && (
          <ConfirmButton
            action={disconnectWhatsAppAction}
            fields={{}}
            label="Disconnect"
            accessibleLabel="Disconnect WhatsApp"
            question={
              whatsapp.sharedWithApp
                ? "Disconnect WhatsApp? Customers' messages stop arriving in ansa, and ansa stops replying. Your WhatsApp Business app keeps working. To end Meta's link too, open the app's settings and remove ansa."
                : "Disconnect WhatsApp? Customers' messages stop arriving in ansa, and ansa stops replying. To end Meta's link too, remove ansa in WhatsApp Manager."
            }
            confirmLabel="Disconnect"
            pendingLabel="Disconnecting..."
          />
        )}
      </div>
    );
  }
  if (page.whatsappMode === "not-set-up") {
    return <p className="text-sm text-muted-foreground">WhatsApp isn&apos;t set up by ansa yet.</p>;
  }
  if (!page.canManage) {
    return <p className="text-sm text-muted-foreground">Not connected. An owner connects WhatsApp here.</p>;
  }
  if (page.whatsappMode === "stand-in" || !page.whatsappSignup) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Development: ansa&apos;s Meta app isn&apos;t set up for WhatsApp (FACEBOOK_APP_ID, FACEBOOK_APP_SECRET and WHATSAPP_SIGNUP_CONFIG_ID in
          .env.core), so this connects a stand-in number.
        </p>
        <PracticeChatAdvice connected={false} personal={personal} />
        <TelegramConnectButton action={connectStandInWhatsAppAction} label="Connect a stand-in WhatsApp number" />
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <ol className="grid list-decimal gap-1 pl-5 text-sm">
        <li>Press Connect WhatsApp and log in with Facebook in Meta&apos;s window.</li>
        <li>Choose your business, then your WhatsApp number: the one you use in the WhatsApp Business app, or a new one.</li>
        <li>Allow ansa to send and receive messages, and finish.</li>
      </ol>
      <p className="text-sm text-muted-foreground">
        With the WhatsApp Business app you keep using it on your phone as always. A personal WhatsApp number can&apos;t be connected to any
        assistant: WhatsApp doesn&apos;t allow it. Meta charges your business for replies after the first 1,000 a month.
      </p>
      <OwnAnswersNote app={IN_THE_APP} personal={personal} />
      <WhatsAppSignupButton signup={page.whatsappSignup} />
    </div>
  );
}

function NumberAdvice({ number, personal }: { number: NonNullable<ConnectionsPage["whatsapp"]>; personal: boolean }) {
  if (number.status === "removed_in_whatsapp") {
    return (
      <p className="text-sm text-muted-foreground">
        Meta says the link to ansa ended (ansa was removed, or the number left the WhatsApp Business app), so no messages arrive. It comes
        back by itself if the link is restored; otherwise disconnect here and connect again.
      </p>
    );
  }
  if (number.isStandIn) {
    return (
      <>
        <PracticeChatAdvice connected personal={personal} />
        <OwnAnswersNote app={IN_THE_APP} personal={personal} />
      </>
    );
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {personal ? "Messages" : "Customers' messages"} arrive in your Inbox, and you can reply from there within 24 hours of their last message (WhatsApp&apos;s rule).
        {number.sharedWithApp ? " You can keep answering in the WhatsApp Business app too." : ""}
      </p>
      {number.sharedWithApp && <OwnAnswersNote app={IN_THE_APP} personal={personal} />}
    </>
  );
}
