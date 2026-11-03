import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { AssistantTextsForm } from "@/components/restaurant-setup/assistant-texts-form";
import { BusinessForm } from "@/components/restaurant-setup/business-form";
import { ContactForm } from "@/components/restaurant-setup/contact-form";
import { HoursForm } from "@/components/restaurant-setup/hours-form";
import { OrdersForm } from "@/components/restaurant-setup/orders-form";
import { buttonVariants } from "@/components/ui/button";
import { getRestaurantProfileFromCore } from "@/lib/core-views/restaurant-setup";
import { currencyOptions, timeZoneOptions } from "@/lib/locale-options";
import { NEW_COMPANY_NAME, sellsFood, setupStepNumber, setupStepsFor, stepToShow, type CompanyKind, type SetupStepKey } from "@/lib/restaurant-setup";
import { requireSessionContext } from "@/lib/session";
import type { RestaurantProfile } from "@/lib/types/restaurant-setup";
import { ChannelsStep } from "./channels-step";
import { ReadyStep } from "./ready-step";

export const metadata: Metadata = { title: "Set up ansa - ansa" };

// What each step says above its form, for a business and for a person (step 50).
const STEP_LEADS: Record<CompanyKind, Record<SetupStepKey, string>> = {
  business: {
    business: "ansa answers for you when you can't: for your business and its customers, or for just you. It takes about five minutes.",
    contact: "So ansa can tell customers how to find you.",
    hours: "ansa tells customers when you're open, in your own time zone.",
    away: "",
    orders: "How customers get their food, and how they pay.",
    assistant: "ansa replies on its own. When it isn't sure, it hands over to you without leaving the customer waiting.",
    connect: "Where your customers' messages reach ansa.",
    ready: "Here is what ansa knows about your business. You can change any of it in Settings.",
  },
  personal: {
    business: "ansa answers for you when you can't: for your business and its customers, or for just you. It takes about five minutes.",
    contact: "",
    hours: "",
    away: "ansa answers for you while you're away: at the times below, when you say \"I'm away\", or when you haven't answered yourself in time.",
    orders: "",
    assistant: "ansa says it is your AI assistant, answers what it can, and takes a note of the rest for you, without leaving anyone waiting.",
    connect: "Where people's messages reach ansa.",
    ready: "Here is what ansa knows. You can change any of it in Settings.",
  },
};

// The orders step of a business that sells no food (a salon, a shop).
const ORDERS_LEAD_WITHOUT_FOOD = "Whether ansa takes orders for you, how customers get them, and how they pay.";

// What a step says above its form: a food business's words, or words that
// fit any other business.
function stepLead(profile: RestaurantProfile, step: SetupStepKey): string {
  if (profile.kind === "business" && step === "orders" && !sellsFood(profile.businessType)) {
    return ORDERS_LEAD_WITHOUT_FOOD;
  }
  return STEP_LEADS[profile.kind][step];
}

// The restaurant setup (step 45), one step at a time: ?step= names one, and a
// step not reached yet shows the first one left instead, so a returning
// owner lands where they stopped. Members wait for an owner.
export default function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  return (
    <main className="mx-auto grid w-full max-w-2xl gap-8 px-6 pt-8 pb-16">
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <WelcomeStep searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function WelcomeStep({ searchParams }: Pick<PageProps<"/welcome">, "searchParams">) {
  await requireSessionContext("/welcome");
  const { step: asked } = await searchParams;
  const profile = await getRestaurantProfileFromCore();
  if (!profile.canManage) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Setting up {profile.companyName}</h1>
        <p className="text-muted-foreground">Only an owner can set ansa up. Everything else in ansa works meanwhile.</p>
        <Link href="/dashboard" className={`${buttonVariants({ variant: "outline" })} justify-self-start`}>
          Go to Home
        </Link>
      </div>
    );
  }
  const steps = setupStepsFor(profile.kind);
  const step = stepToShow(typeof asked === "string" ? asked : undefined, profile.setupProgress, profile.kind);
  const number = setupStepNumber(step, profile.kind);
  return (
    <>
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Step {number} of {steps.length}
        </p>
        <div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${(number / steps.length) * 100}%` }} />
        </div>
        <h1 className="font-display text-4xl leading-tight">{steps[number - 1].title}</h1>
        <p className="text-muted-foreground">{stepLead(profile, step)}</p>
      </div>
      <StepBody step={step} profile={profile} />
    </>
  );
}

function StepBody({ step, profile }: { step: SetupStepKey; profile: RestaurantProfile }) {
  const { settings } = profile;
  const steps = setupStepsFor(profile.kind);
  const backHref = `/welcome?step=${steps[Math.max(setupStepNumber(step, profile.kind) - 2, 0)].key}`;
  if (step === "business") {
    return (
      <BusinessForm
        place="setup"
        kind={profile.setupProgress === 0 ? null : profile.kind}
        // Signup's placeholder name ("New business") is no name to start from.
        companyName={profile.companyName === NEW_COMPANY_NAME ? "" : profile.companyName}
        businessType={profile.businessType}
        description={profile.description}
      />
    );
  }
  if (step === "away") {
    return (
      <HoursForm
        place="setup"
        which="away"
        backHref={backHref}
        timeZone={settings.timeZone}
        openingHours={settings.awayHours}
        replyGraceMinutes={settings.replyGraceMinutes}
        timeZones={timeZoneOptions(settings.timeZone)}
      />
    );
  }
  if (step === "contact") {
    return <ContactForm place="setup" backHref={backHref} address={profile.address} phone={settings.publicPhone} />;
  }
  if (step === "hours") {
    return (
      <HoursForm
        place="setup"
        backHref={backHref}
        timeZone={settings.timeZone}
        openingHours={settings.openingHours}
        timeZones={timeZoneOptions(settings.timeZone)}
      />
    );
  }
  if (step === "orders") {
    return (
      <OrdersForm
        place="setup"
        backHref={backHref}
        takesOrders={settings.takesOrders}
        delivery={settings.delivery}
        deliveryNote={settings.deliveryNote}
        pickup={settings.pickup}
        deliveryFeeCents={settings.deliveryFeeCents}
        paymentNote={settings.paymentNote}
        currency={settings.currency}
        currencies={currencyOptions()}
      />
    );
  }
  if (step === "assistant") {
    return <AssistantTextsForm backHref={backHref} instructions={settings.instructions} holdingReply={settings.holdingReply} />;
  }
  if (step === "connect") {
    return <ChannelsStep backHref={backHref} personal={profile.kind === "personal"} />;
  }
  return <ReadyStep profile={profile} backHref={backHref} />;
}
