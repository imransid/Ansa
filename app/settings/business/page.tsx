import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { BusinessForm } from "@/components/restaurant-setup/business-form";
import { ContactForm } from "@/components/restaurant-setup/contact-form";
import { HoursForm } from "@/components/restaurant-setup/hours-form";
import { OrdersForm } from "@/components/restaurant-setup/orders-form";
import { RestaurantSummary } from "@/components/restaurant-setup/restaurant-summary";
import { getRestaurantProfileFromCore } from "@/lib/core-views/restaurant-setup";
import type { RestaurantProfile } from "@/lib/types/restaurant-setup";
import { currencyOptions, timeZoneOptions } from "@/lib/locale-options";
import { requireSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "What it knows - ansa" };

// Settings → What it knows (step 45): what ansa tells customers about the
// restaurant, the same sections as the setup at /welcome, each saved on its
// own. Owners change it; members read it. For one person (step 50) it is
// "About you", as Settings calls it.
export default function WhatItKnowsPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
        &larr; Settings
      </Link>
      {/* Cache Components rule: the session is only known at request time,
          and the heading depends on whose account it is. */}
      <Suspense fallback={<PageLoading />}>
        <WhatItKnows />
      </Suspense>
    </main>
  );
}

async function WhatItKnows() {
  await requireSessionContext("/settings/business");
  const profile = await getRestaurantProfileFromCore();
  return (
    <>
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{profile.kind === "personal" ? "About you" : "What it knows"}</h1>
        <p className="text-muted-foreground">
          {profile.kind === "personal" ? "What ansa tells people about you." : "What ansa tells people about your business."} Keep it as you would say
          it.
        </p>
      </div>
      <WhatItKnowsSections profile={profile} />
    </>
  );
}

// Who it is for, and for a business where to find it, its hours, orders and menu.
function WhatItKnowsSections({ profile }: { profile: RestaurantProfile }) {
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
              Saved answers
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
