import Link from "next/link";
import { ConciergeBell } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { AwayCard } from "./away-card";

// The website's first screen (step 58, built early; rewritten 2026-11-01
// around the owner's core: ansa is your AI stand-in when you can't answer,
// for you or for your whole business). One promise, one button, who it is
// for, and the signature: a late-night chat answered for you, and the "While
// you were away" note you wake up to, hanging over the hero's edge. Both
// are examples, and say so: a Telegram chat, which works today.
const FOR_WHOM = ["Freelancers", "Consultants", "Agents", "Clinics", "Shops", "Restaurants", "Busy teams"];

export function Hero() {
  return (
    <section className="relative bg-(image:--briefing) text-ivory">
      <SiteHeader overHero />
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pt-6 pb-0 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pt-14">
        <div className="grid content-start gap-6 lg:pb-28">
          <p className="flex items-center gap-2 text-sm font-semibold tracking-wide text-brass uppercase">
            <ConciergeBell aria-hidden className="size-4" />
            Your AI stand-in
          </p>
          <h1 className="font-display text-[2.4rem] leading-[1.04] font-[330] tracking-[-0.035em] sm:text-6xl lg:text-[4.6rem]">
            Never miss a message again.
          </h1>
          <p className="max-w-[44ch] text-lg leading-8 text-ivory/80">
            When you&rsquo;re busy, asleep or offline, ansa answers for you, or for your whole business. It handles what it can, takes a note
            of the rest, and tells you what you missed.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center rounded-[14px] bg-linear-to-b from-[#fbf8ef] to-[#f1eada] px-6 font-semibold text-[#0b3529] shadow-[inset_0_1px_0_#fff,0_0_0_1px_rgb(217_190_138/0.55),0_2px_8px_rgb(0_10_5/0.25)] transition-transform hover:-translate-y-px focus-visible:outline-brass"
            >
              Get started
            </Link>
            <a href="#how-it-works" className="border-b border-brass/60 pb-0.5 font-semibold text-ivory hover:border-ivory focus-visible:outline-brass">
              See how it works
            </a>
          </div>
          <div className="grid gap-2 border-t border-brass/25 pt-5">
            <p className="text-sm text-ivory/70">Made for people whose phone never stops:</p>
            <ul className="flex flex-wrap gap-2">
              {FOR_WHOM.map((who) => (
                <li key={who} className="rounded-full px-3 py-1 text-sm text-ivory/90 shadow-[inset_0_0_0_1px_rgb(217_190_138/0.35)]">
                  {who}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <LateNight />
      </div>
    </section>
  );
}

// 23:40: someone writes while you sleep, ansa answers as your assistant
// (never as you), promises nothing, and the note waits for your morning.
function LateNight() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-md self-end lg:mb-[-8.5rem] lg:max-w-none">
      <div className="grid gap-2.5 rounded-3xl bg-ivory/6 p-4 shadow-[inset_0_0_0_1px_rgb(246_241_228/0.1)] sm:p-5" aria-label="An example conversation">
        <div className="flex justify-between text-xs text-ivory/70">
          <span>
            <b className="font-semibold text-ivory">Sam</b> on Telegram
          </span>
          <span>23:40 · Example</span>
        </div>
        <p className="landing-arrive max-w-[80%] rounded-2xl rounded-bl-md bg-ivory/13 px-3.5 py-2.5 text-sm" style={{ animationDelay: "150ms" }}>
          Hi Rafa! Sorry it&rsquo;s late. Can we move tomorrow&rsquo;s call to 3 pm?
        </p>
        <div className="landing-arrive grid max-w-[88%] justify-items-end gap-1 justify-self-end" style={{ animationDelay: "650ms" }}>
          <span className="flex items-center gap-1.5 text-[0.7rem] text-ivory/70">
            <ConciergeBell aria-hidden className="size-3.5 text-brass" />
            ansa
          </span>
          <p className="rounded-2xl rounded-br-md bg-[#e7eee9] px-3.5 py-2.5 text-sm text-[#11211a]">
            I&rsquo;m Rafa&rsquo;s AI assistant. Rafa is offline until 8:00. I&rsquo;ve passed your request on, and Rafa will confirm in the
            morning.
          </p>
        </div>
        <p className="landing-arrive max-w-[40%] rounded-2xl rounded-bl-md bg-ivory/13 px-3.5 py-2.5 text-sm max-sm:hidden" style={{ animationDelay: "1150ms" }}>
          Perfect, thanks!
        </p>
      </div>
      {/* The morning note prints once the night is over (the delay below). */}
      <div className="landing-print relative mx-4 -mt-3 sm:mx-7" style={{ animationDelay: "1700ms" }}>
        <AwayCard />
      </div>
    </div>
  );
}
