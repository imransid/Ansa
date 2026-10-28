import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Inbox, Lock, Phone, Route, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "ansa - AI first-line support for phone and email",
  description: "An AI voice agent answers your support line. Anything it can't solve becomes a clear ticket for the right person on your team.",
};

const steps = [
  {
    title: "A customer calls or emails",
    text: "An AI voice agent picks up your support line. Emails arrive at your support address as usual.",
  },
  {
    title: "ansa reads what happened",
    text: "It only counts a call as solved when the customer said so in their own words. If in doubt, a person takes over.",
  },
  {
    title: "The right person gets a ticket",
    text: "With a short summary, sent to whoever handles that kind of request and has the fewest open tickets. When it's solved, ansa emails the customer if it has their email address.",
  },
];

const features = [
  { icon: Phone, title: "Phone", text: "The AI voice agent takes the call, and you can read every transcript back." },
  { icon: Inbox, title: "Email", text: "Support emails become tickets. Auto-replies, newsletters and bounces are left out." },
  { icon: Route, title: "Routing", text: "Each teammate picks the categories they handle. Work is spread by load." },
  { icon: FileText, title: "One place", text: "Calls, emails and tickets for your whole team, with times in each person's own time zone." },
  { icon: Lock, title: "Private by default", text: "Transcripts and emails are encrypted at rest. Recordings open only through short-lived links." },
  { icon: ShieldCheck, title: "Kept apart", text: "Every company's data is separated, and that is tested automatically every time our code changes." },
];

export default function LandingPage() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-20 px-6 py-16">
      <section className="grid max-w-2xl gap-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Your first line of support, on the phone and in the inbox.</h1>
        <p className="text-lg text-muted-foreground">
          An AI voice agent answers your support line. Anything it can&apos;t solve becomes a clear ticket for the right person on your team.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={buttonVariants({ size: "lg" })}>
            Get started
          </Link>
          <Link href="/pricing" className={buttonVariants({ size: "lg", variant: "outline" })}>
            See pricing
          </Link>
        </div>
      </section>

      <section className="grid gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="grid content-start gap-2 rounded-lg border p-5">
              <span className="text-sm font-medium text-muted-foreground">Step {index + 1}</span>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">What you get</h2>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <li key={feature.title} className="grid content-start gap-2">
              <feature.icon className="size-5" aria-hidden />
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid justify-items-start gap-4 rounded-lg border p-8">
        <h2 className="text-2xl font-semibold tracking-tight">Set up in an afternoon</h2>
        <p className="max-w-xl text-muted-foreground">
          Create your company, invite your team, pick categories, and forward your support email to the address ansa
          gives you. We set up your phone number.
        </p>
        <Link href="/signup" className={buttonVariants({ size: "lg" })}>
          Create your account
        </Link>
      </section>
    </div>
  );
}
