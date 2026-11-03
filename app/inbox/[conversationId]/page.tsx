import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listAssigneeMenu } from "@/app/tickets/[ticketNumber]/assignee-menu";
import { PageLoading } from "@/components/page-loading";
import { RefreshEvery } from "@/components/refresh-every";
import { StatusDot } from "@/components/status-dot";
import { CHANNEL_LABELS } from "@/lib/conversations";
import { getAccountKindFromCore, getConversationFromCore } from "@/lib/core-views/inbox";
import { getRequestPageFromCore } from "@/lib/core-views/tickets";
import { contactLabel, isUnverifiedSender } from "@/lib/inbox";
import { formatPrice } from "@/lib/menu";
import { ORDER_STATUS_LABELS } from "@/lib/orders";
import { getSessionContext, requireSessionContext } from "@/lib/session";
import type { ConversationPage } from "@/lib/types/conversation-page";
import { AnswersAt, Handler, History, Importance, WaitingReply } from "./conversation-parts";
import { ConversationTimeline } from "./conversation-timeline";
import { ReplyForm } from "./reply-form";
import { RequestBox } from "./request-box";

// Why a Telegram (step 48), Messenger (step 53) or WhatsApp (step 56)
// customer can't be answered from ansa right now.
const REPLY_BLOCKED_TEXT: Record<"telegram" | "messenger" | "whatsapp", Record<NonNullable<ConversationPage["replyBlocked"]>, string>> = {
  telegram: {
    "not-connected": "Telegram isn't connected, so replies can't go from ansa. Connect it in Settings → Connections.",
    "cannot-reply": "ansa isn't allowed to reply on your Telegram account. Allow it in Telegram Business → Chatbots.",
    "window-closed": "Telegram lets ansa reply only within 24 hours of the customer's last message. Answer them in your Telegram app.",
  },
  messenger: {
    "not-connected": "This Facebook Page isn't connected, so replies can't go from ansa. Connect it in Settings → Connections.",
    "cannot-reply": "ansa may not send messages for this Page. Connect it again in Settings → Connections and allow messages.",
    "window-closed": "Messenger lets ansa reply only within 24 hours of the customer's last message. Answer them in Meta Business Suite.",
  },
  whatsapp: {
    "not-connected": "This WhatsApp number isn't connected, so replies can't go from ansa. Connect it in Settings → Connections.",
    "cannot-reply": "ansa may not send messages from this number. Connect WhatsApp again in Settings → Connections.",
    "window-closed": "WhatsApp lets ansa reply only within 24 hours of the customer's last message. Answer them in your WhatsApp Business app.",
  },
};

// The words for a chat's channel (Telegram's for the stand-in chat too).
function blockedTextsFor(channel: string) {
  return channel === "messenger" || channel === "whatsapp" ? REPLY_BLOCKED_TEXT[channel] : REPLY_BLOCKED_TEXT.telegram;
}

// One read per request: the tab title and the page both need it.
const readConversationFromCore = cache(getConversationFromCore);

// "Lena Moretti - ansa", so several conversation tabs can be told apart.
export async function generateMetadata({ params }: PageProps<"/inbox/[conversationId]">): Promise<Metadata> {
  const { conversationId } = await params;
  const session = await getSessionContext();
  const conversation = !session ? null : await readConversationFromCore(conversationId);
  return { title: conversation ? `${contactLabel(conversation)} - ansa` : "Conversation - ansa" };
}

// One conversation of the Inbox (step 47): its entries, who handles it (Take
// over, Hand back), a reply on chat channels, and its open request with that
// request's own actions (assign, Done) and notes.
export default function ConversationPageRoute({ params, searchParams }: PageProps<"/inbox/[conversationId]">) {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-6">
      {/* Cache Components rule: the session and the id are only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <ConversationContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ConversationContent({ params, searchParams }: Pick<PageProps<"/inbox/[conversationId]">, "params" | "searchParams">) {
  const { conversationId } = await params;
  // ?edit=<id>: the assistant's waiting reply opened in the reply box (step 49).
  const { edit } = await searchParams;
  const session = await requireSessionContext(`/inbox/${encodeURIComponent(conversationId)}`);
  const conversation = await readConversationFromCore(conversationId);
  if (!conversation) {
    notFound();
  }
  const openTicketNumber = conversation.openTicket?.ticketNumber;
  const [request, kind] = await Promise.all([
        // The open request's own page read, already made for the conversation (React cache).
        openTicketNumber ? getRequestPageFromCore(String(openTicketNumber)) : Promise.resolve(null),
        getAccountKindFromCore(),
      ]);
  const assigneeChoices = request?.assigneeChoices ?? [];
  const waiting = conversation.entries.findLast((entry) => entry.sendStatus === "draft" && entry.text !== null);
  const editing = waiting && edit === waiting.id ? { id: waiting.id, text: waiting.text ?? "" } : undefined;
  return (
    <>
      {/* The customer's messages and ansa's replies show up by themselves. */}
      <RefreshEvery seconds={5} />
      <div className="grid gap-2">
        <Link href="/inbox" className="text-sm text-muted-foreground hover:underline">
          &larr; Inbox
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{contactLabel(conversation)}</h1>
        <p className="text-sm text-muted-foreground">
          {CHANNEL_LABELS[conversation.channel]}
          {isUnverifiedSender(conversation) ? ": the sender's address was not verified" : ""}
        </p>
        <Handler conversation={conversation} />
        {conversation.assistantDueAt && (
          <AnswersAt conversationId={conversation.id} dueAt={conversation.assistantDueAt} canAnswerNow={conversation.canAnswerNow} />
        )}
        <Importance conversationId={conversation.id} important={conversation.important} />
      </div>
      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <section aria-labelledby="conversation-heading" className="grid content-start gap-4">
          <h2 id="conversation-heading" className="sr-only">
            Conversation
          </h2>
          <ConversationTimeline entries={conversation.entries} senderName={contactLabel(conversation)} channel={conversation.channel} />
          {waiting && !editing && <WaitingReply conversationId={conversation.id} messageId={waiting.id} />}
          {conversation.canReply && conversation.replyBlocked ? (
            <p className="text-sm text-muted-foreground">{blockedTextsFor(conversation.channel)[conversation.replyBlocked]}</p>
          ) : conversation.canReply ? (
            <ReplyForm
              // Keyed by the address, not by the waiting reply: a refresh
              // that finds the reply being edited gone (sent, discarded, or
              // replaced by a newer one) must not empty what was typed.
              key={typeof edit === "string" ? edit : "new"}
              conversationId={conversation.id}
              handledByAssistant={conversation.handledBy === "assistant"}
              draft={editing}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Calls and emails can&apos;t be answered from ansa yet.</p>
          )}
        </section>
        <aside className="grid content-start gap-6">
          {conversation.openTicket ? (
            <RequestBox
              // A newer request arriving while the page refreshes gets a box of
              // its own: a note typed for one request never goes to another.
              key={conversation.openTicket.id}
              conversation={conversation}
              ticket={conversation.openTicket}
              teamMembers={listAssigneeMenu(assigneeChoices, conversation.openTicket)}
              canAssign={kind === "business" && assigneeChoices.length > 1}
              canReopen={session.role === "owner"}
              relatedArticles={request?.relatedArticles ?? []}
            />
          ) : (
            <StatusDot tone="success">Nothing needs you in this conversation.</StatusDot>
          )}
          {conversation.otherOpenTickets.length > 0 && (
            <section className="grid gap-1 text-sm">
              <h2 className="font-semibold">Also open</h2>
              {conversation.otherOpenTickets.map((ticket) => (
                <Link key={ticket.ticketNumber} href={`/tickets/${ticket.ticketNumber}`} className="underline">
                  #{ticket.ticketNumber}: {ticket.subject}
                </Link>
              ))}
            </section>
          )}
          {conversation.orders.length > 0 && (
            <section aria-labelledby="orders-heading" className="grid gap-1 text-sm">
              <h2 id="orders-heading" className="font-semibold">
                Their orders
              </h2>
              {conversation.orders.map((order) => (
                <Link key={order.orderNumber} href="/orders" className="underline">
                  #{order.orderNumber}: {ORDER_STATUS_LABELS[order.status]}, {formatPrice(order.totalCents, order.currency)}
                </Link>
              ))}
            </section>
          )}
          <History activity={conversation.activity} personal={kind === "personal"} />
        </aside>
      </div>
    </>
  );
}
