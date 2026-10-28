import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ANALYTICS_PERIOD_LABELS } from "@/lib/analytics/kinds";
import { METRICS_READ_DAYS, X_METRICS_READ_DAYS } from "@/lib/metric-definitions";
import { describePostsStillNeeded } from "@/lib/performance-review/readiness";
import { requireSessionContext } from "@/lib/session";
import { getAnalyticsPageForSession, type AnalyticsPage } from "@/services/analytics-page";
import { JobList } from "../publishing/job-list";
import { CollectionStatus } from "./collection-status";
import { MetricDefinitionsList } from "./metric-definitions-list";
import { PerformanceReviewView } from "./performance-review";
import { PeriodLinks } from "./period-links";
import { PlatformTotalsList } from "./platform-totals";
import { PostTable } from "./post-table";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Analytics - Co-Founder - ansa" };

// "Review performance" asks Claude inside this page's server action (two
// tries of up to 2 minutes): the host's default time limit can be as short
// as 10 seconds.
export const maxDuration = 300;

export default function AnalyticsPageRoute({ searchParams }: PageProps<"/cofounder/analytics">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 p-6">
      {/* Cache Components rule: the session and the URL's ?period= are only
          known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <AnalyticsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// The company's post numbers (step 42): the period's totals per platform,
// each post's latest numbers, the publishing problems of the period, the
// newest performance review and what each number means. Everyone reads it;
// owners ask for a review.
async function AnalyticsContent({ searchParams }: Pick<PageProps<"/cofounder/analytics">, "searchParams">) {
  const urlQuery = await searchParams;
  const session = await requireSessionContext("/cofounder/analytics");
  const page = await getAnalyticsPageForSession(session, urlQuery);
  const periodLabel = ANALYTICS_PERIOD_LABELS[page.period].toLowerCase();

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          How the posts that went out through the{" "}
          <Link href="/cofounder/queue" className="underline">
            queue
          </Link>{" "}
          did, in the numbers each platform gives. ansa reads each post&apos;s numbers about once a day, from an hour
          after it went out until {METRICS_READ_DAYS} days after ({X_METRICS_READ_DAYS} on X, which gives link clicks for
          a post&apos;s first 30 days only). A number a platform doesn&apos;t give is shown as not available, never as 0:
          see what each number means below.
        </p>
        <PeriodLinks period={page.period} />
        <CollectionStatus activity={page.activity} />
      </section>

      {page.postCount === 0 ? (
        <Section id="analytics-posts" title="Posts">
          <p className="text-sm text-muted-foreground">
            No published posts in this period ({periodLabel}). Posts show here once they went out from the{" "}
            <Link href="/cofounder/queue" className="underline">
              queue
            </Link>
            .
          </p>
        </Section>
      ) : (
        <PeriodPosts page={page} />
      )}

      <Section id="analytics-problems" title={`Publishing problems (${periodLabel})`}>
        <p className="text-sm text-muted-foreground">
          Posts that failed or need a person&apos;s check, changed in this period. Act on them in the{" "}
          <Link href="/cofounder/queue" className="underline">
            queue
          </Link>
          {page.problems.length >= 50 ? "; the newest 50 are shown." : "."}
        </p>
        {page.problems.length > 0 ? (
          <JobList jobs={page.problems} canManage={false} showDraft />
        ) : (
          <p className="text-sm text-muted-foreground">No post failed or needs attention in this period.</p>
        )}
      </Section>

      <Section id="analytics-review" title="Performance review">
        <ReviewSection page={page} />
      </Section>

      <Section id="analytics-definitions" title="What the numbers mean">
        <p className="text-sm text-muted-foreground">
          Each platform counts in its own way, so compare posts of one platform first. Some numbers need a permission ansa
          doesn&apos;t ask the platform for yet: those stay empty until it does.
        </p>
        <MetricDefinitionsList />
      </Section>
    </>
  );
}

function PeriodPosts({ page }: { page: AnalyticsPage }) {
  return (
    <>
      <Section id="analytics-totals" title="Totals by platform">
        <p className="text-sm text-muted-foreground">
          Each post&apos;s latest numbers, added up. A post without a number adds nothing to its total.
        </p>
        <PlatformTotalsList totals={page.totals} />
      </Section>
      <Section id="analytics-posts" title={`Posts (${page.postCount})`}>
        {page.postCount > page.posts.length && <p className="text-sm text-muted-foreground">The newest {page.posts.length} are listed; the totals count them all.</p>}
        <PostTable posts={page.posts} />
      </Section>
    </>
  );
}

// The newest review, and what can be done about a new one: the button for
// owners when the period has enough posts with numbers, else why not.
function ReviewSection({ page }: { page: AnalyticsPage }) {
  const readiness =
    page.postsNeededForReview > 0 ? (
      <p className="text-sm text-muted-foreground">{describePostsStillNeeded(page.postsWithNumbers)} Pick a longer period, or wait for more numbers.</p>
    ) : page.canReview ? (
      <ReviewForm period={page.period} hasReview={page.review !== null} />
    ) : (
      <p className="text-sm text-muted-foreground">Only owners ask for a review. You can read the newest one here.</p>
    );
  return (
    <>
      <p className="max-w-3xl text-sm text-muted-foreground">
        The AI reads this period&apos;s numbers (never the posts&apos; text beyond their topics) and says what they show,
        citing every number it uses. ansa checks each cited number against the ones it sent, and drops any finding with a
        number that doesn&apos;t match. The newest review is passed to the next{" "}
        <Link href="/cofounder/strategy" className="underline">
          marketing plan
        </Link>
        .
      </p>
      {readiness}
      {page.review ? <PerformanceReviewView review={page.review} /> : <p className="text-sm text-muted-foreground">No review yet.</p>}
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
