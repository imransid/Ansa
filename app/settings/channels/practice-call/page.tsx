import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { getPracticePhoneFromCore } from "@/lib/core-views/phone";
import { madeUpCallerNumber } from "@/lib/practice-phone/caller";
import { requireSessionContext } from "@/lib/session";
import { PracticePhone } from "./practice-phone";

export const metadata: Metadata = { title: "Practice phone - ansa" };

// Each turn waits for the AI (and, for a recording, the brain's Whisper).
export const maxDuration = 300;

// Settings → Connections → Practice phone (step 55, development only): call
// your own ansa from this computer, as someone would when you can't answer.
// Core answers with the same assistant as your chats; the call lands in your
// Inbox. Real calls will come through ansa's phone number once a provider
// is chosen for production.
export default function PracticeCallPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings/channels" className="text-sm text-muted-foreground hover:underline">
          &larr; Connections
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Practice phone</h1>
        <p className="text-muted-foreground">
          Call your own ansa from this computer, as someone would when you can&apos;t answer. It answers with the same brain as your chats, and the
          call lands in your Inbox.
        </p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <PracticeCall />
      </Suspense>
    </main>
  );
}

async function PracticeCall() {
  await requireSessionContext("/settings/channels/practice-call");
  const phone = await getPracticePhoneFromCore();
  if (!phone.available) {
    return (
      <p className="text-sm text-muted-foreground">
        {phone.isOwner
          ? "The practice phone is for development only. Real calls will come through ansa's phone number."
          : "Only owners can use the practice phone."}
      </p>
    );
  }
  // A made-up caller of its own for each visit: made after the session was
  // read, as Cache Components require of a random value (one per request).
  return <PracticePhone firstNumber={madeUpCallerNumber()} />;
}
