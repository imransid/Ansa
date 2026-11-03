import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { DevMailText } from "@/components/dev-mail-text";
import { LocalDateTime } from "@/components/local-date-time";
import { PageLoading } from "@/components/page-loading";
import { getDevMailboxFromCore } from "@/lib/core-views/dev-mailbox";
import { requireSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Development mailbox - ansa" };

// Settings → Connections → Development mailbox (for trying and showing ansa
// on the laptop): the emails ansa wrote to your team and your customers,
// which on this computer go nowhere (core/internal/devmail): invites,
// "solved" emails, alerts about requests and orders. Owners only;
// development only.
export default function DevMailboxPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings/channels" className="text-sm text-muted-foreground hover:underline">
          &larr; Connections
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Development mailbox</h1>
        <p className="text-muted-foreground">
          On this computer ansa doesn&apos;t send email: it writes it here. The newest 50 to your team and your customers.
        </p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <Mailbox />
      </Suspense>
    </main>
  );
}

async function Mailbox() {
  await requireSessionContext("/settings/channels/mailbox");
  const mailbox = await getDevMailboxFromCore();
  if (!mailbox.available) {
    return <p className="text-sm text-muted-foreground">The development mailbox is for owners, on a computer where ansa doesn&apos;t send real email.</p>;
  }
  if (mailbox.emails.length === 0) {
    return <p className="text-sm text-muted-foreground">No emails yet.</p>;
  }
  return (
    <ul className="grid gap-3">
      {mailbox.emails.map((email) => (
        <li key={email.id} className="grid gap-2 rounded-2xl border bg-card p-4">
          <div className="grid gap-0.5">
            <p className="font-medium">{email.subject}</p>
            <p className="text-sm text-muted-foreground">
              To {email.to} · <LocalDateTime iso={email.at} />
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-link">Open</summary>
            <div className="mt-2">
              <DevMailText text={email.text} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
