import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { getPracticeChatFromCore } from "@/lib/core-views/practice-chat";
import { requireSessionContext } from "@/lib/session";
import { PracticeChat } from "./practice-chat";

export const metadata: Metadata = { title: "Practice chat - ansa" };

// Settings → Connections → Practice chat (step 58, development only): write
// as one of your customers on WhatsApp, Telegram or Messenger, through the
// stand-in accounts, and see what they would see. The messages land in your
// Inbox like any customer's, so a demo shows both sides on one laptop.
export default function PracticeChatPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings/channels" className="text-sm text-muted-foreground hover:underline">
          &larr; Connections
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Practice chat</h1>
        <p className="text-muted-foreground">
          Write as one of your customers. Your message arrives in your Inbox, and ansa answers it as it would on the real app: questions,
          orders, complaints. Open your Inbox or Orders in another tab to see your side.
        </p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <Chat />
      </Suspense>
    </main>
  );
}

async function Chat() {
  await requireSessionContext("/settings/channels/practice-chat");
  const chat = await getPracticeChatFromCore();
  if (!chat.available) {
    return (
      <p className="text-sm text-muted-foreground">
        {chat.isOwner
          ? "The practice chat is for development only. Real customers write on the channels you connect."
          : "Only owners can use the practice chat."}
      </p>
    );
  }
  return <PracticeChat standIns={chat.standIns} />;
}
