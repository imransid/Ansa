import Link from "next/link";
import { ConciergeBell } from "lucide-react";
import { WEBSITE_PACKAGES } from "@/lib/website-packages";

// The last word: one line, one button (the same as the hero's). The free
// trial asks for no card (step 57).
export function FinalCall() {
  return (
    <section className="bg-background">
      <div className="mx-auto grid w-full max-w-6xl justify-items-center gap-6 px-6 py-24 text-center">
        <ConciergeBell aria-hidden className="size-8 text-link dark:text-brass" strokeWidth={1.5} />
        <h2 className="max-w-[20ch] font-display text-4xl leading-tight font-[340] tracking-[-0.03em] sm:text-5xl">
          Never leave anyone waiting again.
        </h2>
        <p className="max-w-[46ch] text-muted-foreground">For you, or for your whole business. ansa answers when you can&rsquo;t, and tells you what you missed.</p>
        <Link
          href="/signup"
          className="inline-flex h-12 items-center rounded-[14px] bg-primary bg-linear-to-b from-primary-highlight to-primary px-6 font-semibold text-primary-foreground shadow-button transition-transform hover:-translate-y-px"
        >
          Get started
        </Link>
        <p className="text-sm text-muted-foreground">Ready in about five minutes. {WEBSITE_PACKAGES.trialDays} days free, no card needed.</p>
      </div>
    </section>
  );
}
