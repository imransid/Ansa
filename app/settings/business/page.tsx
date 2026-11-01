import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { BusinessForm } from "@/components/restaurant-setup/business-form";
import { ContactForm } from "@/components/restaurant-setup/contact-form";
import { HoursForm } from "@/components/restaurant-setup/hours-form";
import { OrdersForm } from "@/components/restaurant-setup/orders-form";
import { RestaurantSummary } from "@/components/restaurant-setup/restaurant-summary";
import { isCoreOn } from "@/lib/core-api";
import { getRestaurantProfileFromCore } from "@/lib/core-views/restaurant-setup";
import { currencyOptions, timeZoneOptions } from "@/lib/locale-options";
import { requireSessionContext } from "@/lib/session";
import { getRestaurantProfileForSession } from "@/services/restaurant-setup";

export const metadata: Metadata = { title: "What it knows - ansa" };

// Settings → What it knows (step 45): what ansa tells customers about the
// restaurant, the same sections as the setup at /welcome, each saved on its
// own. Owners change it; members read it.
export default function WhatItKnowsPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
          &larr; Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">What it knows</h1>
        <p className="text-muted-foreground">What ansa tells people about you or your business. Keep it as you would say it.</p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <WhatItKnows />
      </Suspense>
    </main>
  );
}

async function WhatItKnows() {
  const session = await requireSessionContext("/settings/business");
  // The new backend when it is switched on (lib/core-api.ts), else services/.
  const profile = isCoreOn() ? await getRestaurantProfileFromCore() : await getRestaurantProfileForSession(session);
  const extraInfo = (
    <>
    <Section title="Menu">
      <p className="text-sm text-muted-foreground">
        Your dishes and prices, which ansa quotes and never makes up:{" "}
        <Link href="/settings/menu" className="text-foreground underline">
          Menu
        </Link>
        .
      </p>
    </Section>
    <Section title="Extra information">
      <p className="text-sm text-muted-foreground">
        Longer answers ansa can quote, like your allergy policy or how catering works:{" "}
        <Link href="/knowledge" className="text-foreground underline">
          Knowledge
        </Link>
        .
      </p>
    </Section>
    </>
  );
  if (!profile.canManage) {
    return (
      <>
        <p className="text-sm text-muted-foreground">Only owners change these.</p>
        <RestaurantSummary profile={profile} show="business" />
        {extraInfo}
      </>
    );
  }
  const { settings } = profile;
  const whoForm = (
    <Section title="Who ansa is for">
      <BusinessForm
        place="settings"
        kind={profile.kind}
        companyName={profile.companyName}
        businessType={profile.businessType}
        description={profile.description}
      />
    </Section>
  );
  // A person (step 50): who they are, and what ansa may quote. When ansa
  // answers for them is on Settings → Assistant.
  if (profile.kind === "personal") {
    return (
      <div className="grid gap-10">
        {whoForm}
        <Section title="Extra information">
          <p className="text-sm text-muted-foreground">
            Longer answers ansa can give for you, like how to book time with you or what you do:{" "}
            <Link href="/knowledge" className="text-foreground underline">
              Knowledge
            </Link>
            .
          </p>
        </Section>
      </div>
    );
  }
  return (
    <div className="grid gap-10">
      {whoForm}
      <Section title="Where to find you">
        <ContactForm place="settings" address={profile.address} phone={settings.publicPhone} />
      </Section>
      <Section title="Opening hours">
        <HoursForm place="settings" timeZone={settings.timeZone} openingHours={settings.openingHours} timeZones={timeZoneOptions(settings.timeZone)} />
      </Section>
      <Section title="Orders and payment">
        <OrdersForm
          place="settings"
          takesOrders={settings.takesOrders}
          delivery={settings.delivery}
          deliveryNote={settings.deliveryNote}
          pickup={settings.pickup}
          deliveryFeeCents={settings.deliveryFeeCents}
          paymentNote={settings.paymentNote}
          currency={settings.currency}
          currencies={currencyOptions()}
        />
      </Section>
      {extraInfo}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
