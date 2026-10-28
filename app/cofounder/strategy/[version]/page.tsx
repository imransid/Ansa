import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSessionContext } from "@/lib/session";
import { getPlanVersionForSession } from "@/services/marketing-strategy";
import { PlanView } from "../plan-view";

export const metadata: Metadata = { title: "Plan version - Co-Founder - ansa" };

export default function PlanVersionPage({ params }: PageProps<"/cofounder/strategy/[version]">) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's version are only
          known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <PlanVersionContent params={params} />
      </Suspense>
    </main>
  );
}

// One version of the company's marketing plan (step 37), read-only, with
// links to the versions before and after it. Everyone in the company reads it.
async function PlanVersionContent({ params }: Pick<PageProps<"/cofounder/strategy/[version]">, "params">) {
  const { version } = await params;
  const session = await requireSessionContext(`/cofounder/strategy/${encodeURIComponent(version)}`);
  const page = await getPlanVersionForSession(session, version);
  // A bad number, or one the company has no version of: both look the same (../not-found.tsx).
  if (!page) {
    notFound();
  }
  const { plan, newestVersion } = page;
  const isCurrent = plan.version === newestVersion;

  return (
    <>
      <nav aria-label="Plan versions" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <Link href="/cofounder/strategy" className="hover:underline">
          &larr; Strategy
        </Link>
        <span className="flex flex-wrap gap-x-4">
          {plan.version > 1 && (
            <Link href={`/cofounder/strategy/${plan.version - 1}`} className="underline">
              Older version
            </Link>
          )}
          {!isCurrent && (
            <Link href={`/cofounder/strategy/${plan.version + 1}`} className="underline">
              Newer version
            </Link>
          )}
        </span>
      </nav>
      {/* As on the Strategy page: the page's heading, then the plan's own (an h2). */}
      <h1 className="text-xl font-semibold">Marketing strategy</h1>
      <p className="rounded-lg border p-3 text-sm">
        {isCurrent ? (
          "This is the current plan."
        ) : (
          <>
            An older version. The current plan is{" "}
            <Link href="/cofounder/strategy" className="underline">
              version {newestVersion}
            </Link>
            .
          </>
        )}
      </p>
      <PlanView plan={plan} title={`Plan version ${plan.version}`} />
    </>
  );
}
