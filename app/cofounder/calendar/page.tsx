import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionContext } from "@/lib/session";
import { getCalendarPageForSession } from "@/services/publishing-pages";
import { CalendarDays } from "./calendar-days";
import { PlanWeeksForm } from "./plan-weeks-form";

export const metadata: Metadata = { title: "Calendar - Co-Founder - ansa" };

// "Plan the next 2 weeks" asks Claude inside this page's server action (up
// to about 3 minutes): the host's default time limit can be as short as 10
// seconds.
export const maxDuration = 300;

export default function CalendarPage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <CalendarContent />
      </Suspense>
    </main>
  );
}

// The company's content calendar (step 41): the next four weeks, day by day
// in the viewer's own timezone, with the posts scheduled (or out) and the
// drafts and ideas planned; owners can have the AI plan two weeks of ideas
// from the marketing plan.
async function CalendarContent() {
  const session = await requireSessionContext("/cofounder/calendar");
  const calendar = await getCalendarPageForSession(session);

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The next four weeks in your timezone: posts scheduled (and those that went out, or didn&apos;t) and the drafts
          and ideas planned for a day. Open an entry to write, approve or schedule it; the{" "}
          <Link href="/cofounder/queue" className="underline">
            queue
          </Link>{" "}
          lists every post with what became of it.
        </p>
        <PlanSection planVersion={calendar.planVersion} canPlan={calendar.canPlan} />
      </section>
      <section className="grid gap-3" aria-labelledby="calendar-days">
        <h2 id="calendar-days" className="text-lg font-semibold">
          The next four weeks
        </h2>
        <p className="text-xs text-muted-foreground">
          Stripes: blue, on its way; green, published; red, didn&apos;t go out or needs a check; amber, a draft planned for
          that day; dashed grey, an idea.
        </p>
        <CalendarDays items={calendar.items} />
      </section>
    </>
  );
}

// "Plan the next 2 weeks", or why it isn't offered.
function PlanSection({ planVersion, canPlan }: { planVersion: number | null; canPlan: boolean }) {
  if (planVersion === null) {
    return (
      <p className="max-w-3xl rounded-lg border p-3 text-sm">
        The AI plans the calendar from your marketing plan, and there isn&apos;t one yet: make one on the{" "}
        <Link href="/cofounder/strategy" className="underline">
          Strategy
        </Link>{" "}
        page first.
      </p>
    );
  }
  if (!canPlan) {
    return <p className="text-sm text-muted-foreground">Only owners plan the calendar with the AI.</p>;
  }
  return (
    <div className="grid max-w-3xl gap-2 rounded-lg border p-3">
      <p className="text-sm">
        The AI proposes the next two weeks of posts from marketing plan version {planVersion}: its content pillars,
        campaigns and how often to post on each platform. Each becomes an idea on its day (a topic, nothing written):
        nothing is published or approved by it.
      </p>
      <PlanWeeksForm />
    </div>
  );
}
