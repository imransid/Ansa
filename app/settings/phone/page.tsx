import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { RefreshEvery } from "@/components/refresh-every";
import { getDevicesFromCore } from "@/lib/core-views/devices";
import { getRestaurantProfileFromCore } from "@/lib/core-views/restaurant-setup";
import { requireSessionContext } from "@/lib/session";
import { ConnectPhone } from "./connect-phone";
import { FollowPhoneSection } from "./follow-phone-section";
import { PhoneList } from "./phone-list";

export const metadata: Metadata = { title: "Your phone - ansa" };

// Settings → Your phone (the owner's design of 2026-11-04): the ansa app,
// connected by scanning a code shown here; the connected phones and whether
// each still checks in; and "Answer for me when my phone is unreachable".
// Owners connect, remove and change it; members read.
export default function PhoneSettingsPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
          &larr; Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Your phone</h1>
        <p className="text-muted-foreground">
          The ansa app shows what ansa is doing and who needs you, and says &ldquo;I&apos;m away&rdquo; for you with one tap. While
          your phone checks in, ansa knows you can be reached.
        </p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <PhoneSettings />
      </Suspense>
    </main>
  );
}

async function PhoneSettings() {
  await requireSessionContext("/settings/phone");
  const [page, profile] = await Promise.all([getDevicesFromCore(), getRestaurantProfileFromCore()]);
  return (
    <>
      {/* A phone that just scanned the code, and every check-in, show up by themselves. */}
      <RefreshEvery seconds={5} />
      <section aria-labelledby="connect-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="connect-heading" className="text-lg font-semibold">
          Connect your phone
        </h2>
        {page.canChange ? (
          <ConnectPhone devices={page.devices} />
        ) : (
          <p className="text-sm text-muted-foreground">An owner connects phones here.</p>
        )}
      </section>
      <section aria-labelledby="phones-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="phones-heading" className="text-lg font-semibold">
          Connected phones
        </h2>
        <PhoneList devices={page.devices} canRemove={page.canChange} />
      </section>
      <section aria-labelledby="follow-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 id="follow-heading" className="text-lg font-semibold">
          Answer for me when my phone is unreachable
        </h2>
        <FollowPhoneSection page={page} kind={profile.kind} answerWhen={profile.settings.answerWhen} />
      </section>
    </>
  );
}
