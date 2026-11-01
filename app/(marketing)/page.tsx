import type { Metadata } from "next";
import { Channels } from "./_landing/channels";
import { EveningLog } from "./_landing/evening-log";
import { FinalCall } from "./_landing/final-call";
import { Hero } from "./_landing/hero";
import { HowItWorks } from "./_landing/how-it-works";
import { KnowsWhenToStop } from "./_landing/knows-when-to-stop";
import { Questions } from "./_landing/questions";
import { TwoWays } from "./_landing/two-ways";
import { WhoItsFor } from "./_landing/who-its-for";

export const metadata: Metadata = {
  title: "ansa - your AI stand-in when you can't answer",
  description:
    "When you're busy, asleep or offline, ansa answers your messages for you or for your whole business, takes a note of what needs you, and tells you what you missed.",
};

// The website's home page (built ahead of step 57; rewritten on 2026-11-01
// around the owner's core: ansa answers for you when you can't, for one
// person or a business). Fully static. Every sentence about something not
// built yet is marked "LAUNCH CHECK" in its section: step 57 checks each
// before the site goes public.
export default function LandingPage() {
  return (
    <>
      <Hero />
      <TwoWays />
      <WhoItsFor />
      <HowItWorks />
      <EveningLog />
      <KnowsWhenToStop />
      <Channels />
      <Questions />
      <FinalCall />
    </>
  );
}
