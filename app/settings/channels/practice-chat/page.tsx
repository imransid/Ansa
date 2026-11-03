import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { getPracticeCommentPostsFromCore } from "@/lib/core-views/comments";
import { getPracticeChatFromCore } from "@/lib/core-views/practice-chat";
import { getSetupStateFromCore } from "@/lib/core-views/restaurant-setup";
import { requireSessionContext } from "@/lib/session";
import { PracticeChat } from "./practice-chat";

export const metadata: Metadata = { title: "Practice chat - ansa" };

// What the practice chat does: for a business, its customers (orders
// included); for one person (step 50), someone writing to them.
const BUSINESS_INTRO =
  "Write as one of your customers. Your message arrives in your Inbox, and ansa answers it as it would on the real app: questions, " +
  "orders, complaints. An email becomes a request in your Inbox, as a forwarded email does, and a Facebook comment is answered " +
  "under your post or in Messenger. Open your Inbox or Orders in another tab to see your side.";
const PERSONAL_INTRO =
  "Write as someone who writes to you. Your message arrives in your Inbox, and ansa answers it as it would on the real app. An " +
  "email becomes a note in your Inbox, as a forwarded email does. Open your Inbox in another tab to see your side.";

// Settings → Connections → Practice chat (step 58, development only): write
// as one of your customers on WhatsApp, Telegram or Messenger, through the
// stand-in accounts, and see what they would see; send an email as one, to
// your forwarding address; or (a business) comment under one of the
// stand-in Facebook Page's posts. The messages land in your Inbox like any
// customer's, so a demo shows both sides on one laptop.
export default function PracticeChatPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings/channels" className="text-sm text-muted-foreground hover:underline">
          &larr; Connections
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Practice chat</h1>
        {/* Cache Components rule: who the account is for is only known at request time. */}
        <Suspense fallback={null}>
          <Intro />
        </Suspense>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <Chat />
      </Suspense>
    </main>
  );
}

// What the practice chat is for, as the account is: a business's or one person's.
async function Intro() {
  await requireSessionContext("/settings/channels/practice-chat");
  const { kind } = await getSetupStateFromCore();
  return <p className="text-muted-foreground">{kind === "personal" ? PERSONAL_INTRO : BUSINESS_INTRO}</p>;
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
  const { kind } = await getSetupStateFromCore();
  // A comment under the Facebook Page's posts is a business's.
  const commentPosts = kind === "personal" ? [] : await getPracticeCommentPostsFromCore();
  return <PracticeChat standIns={chat.standIns} email={chat.email} personal={kind === "personal"} commentPosts={commentPosts} />;
}
