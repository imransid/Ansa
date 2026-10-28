import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { RefreshWhilePending } from "@/components/refresh-while-pending";
import { requireSessionContext } from "@/lib/session";
import { getQueuePageForSession, type PublishJobListItem } from "@/services/publishing-pages";
import { ActivityList } from "../publishing/activity-list";
import { JobList } from "../publishing/job-list";
import { AutopublishRules } from "./autopublish-rules";

export const metadata: Metadata = { title: "Queue - Co-Founder - ansa" };

// "Publish now" and "Try again now" send the post right after the action's
// answer, and a video's upload can take minutes: the host's default time
// limit can be as short as 10 seconds.
export const maxDuration = 300;

export default function QueuePage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <QueueContent />
      </Suspense>
    </main>
  );
}

// The company's publishing queue (step 41): what needs a person first, then
// what waits to go out, what failed, went out or was canceled, the
// auto-publish rules and who did what. Everyone reads it; owners act.
async function QueueContent() {
  const session = await requireSessionContext("/cofounder/queue");
  const queue = await getQueuePageForSession(session);
  const { canManage, counts } = queue;

  return (
    <>
      <RefreshWhilePending isPending={queue.isBusy} />
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Publishing queue</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every post on its way to a social account, and what became of it. A post goes out at its time only while its
          draft is still the version an owner approved (or one an auto-publish rule covers), its account is connected and
          the people behind it are still owners: that is checked again right before it is sent. Schedule a post from its
          draft in the <Link href="/cofounder/studio" className="underline">studio</Link>; the{" "}
          <Link href="/cofounder/calendar" className="underline">calendar</Link> shows them by day.
          {canManage ? "" : " Only owners schedule, cancel or retry posts."}
        </p>
      </section>
      {queue.needsAttention.length > 0 && (
        <JobSection id="queue-attention" title={`Needs attention (${counts.needs_attention})`} note={NEEDS_ATTENTION_NOTE}>
          <JobList jobs={queue.needsAttention} canManage={canManage} showDraft />
        </JobSection>
      )}
      {/* The dashboard's "posts scheduled for the next 7 days" links here, by this id. */}
      <JobSection id="queue-waiting" title={`Scheduled (${counts.queued + counts.publishing})`} note={shownNote(queue.waiting, counts.queued + counts.publishing)}>
        <JobsOrEmpty jobs={queue.waiting} canManage={canManage} emptyText="Nothing is scheduled. Approve a draft in the studio, then schedule it from its page." />
      </JobSection>
      <JobSection id="queue-failed" title={`Failed (${counts.failed})`} note={shownNote(queue.failed, counts.failed)}>
        <JobsOrEmpty jobs={queue.failed} canManage={canManage} emptyText="No post failed." />
      </JobSection>
      <JobSection id="queue-published" title={`Published (${counts.published})`} note={shownNote(queue.published, counts.published)}>
        <JobsOrEmpty jobs={queue.published} canManage={canManage} emptyText="Nothing has gone out yet." />
      </JobSection>
      <JobSection id="queue-canceled" title={`Canceled (${counts.canceled})`} note={shownNote(queue.canceled, counts.canceled)}>
        <JobsOrEmpty jobs={queue.canceled} canManage={canManage} emptyText="No post was canceled." />
      </JobSection>
      <AutopublishRules rules={queue.rules} pillars={queue.pillars} canManage={canManage} />
      <section className="grid gap-3" aria-labelledby="queue-activity">
        <h2 id="queue-activity" className="text-lg font-semibold">
          Activity
        </h2>
        <p className="text-sm text-muted-foreground">Who did what with your accounts, drafts, posts, rules and plans, newest first (the last 200).</p>
        <ActivityList entries={queue.activity} linkDrafts emptyText="Nothing has happened yet." />
      </section>
    </>
  );
}

const NEEDS_ATTENTION_NOTE =
  "The platform may or may not have made these posts (it answered unclearly, or the run sending one was cut off). ansa never sends one again by itself: that could post it twice.";

function JobSection({ id, title, note, children }: { id: string; title: string; note?: string | null; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {note && <p className="max-w-3xl text-sm text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

function JobsOrEmpty({ jobs, canManage, emptyText }: { jobs: PublishJobListItem[]; canManage: boolean; emptyText: string }) {
  return jobs.length > 0 ? <JobList jobs={jobs} canManage={canManage} showDraft /> : <p className="text-sm text-muted-foreground">{emptyText}</p>;
}

// Says how many are shown when there are more than the list holds.
function shownNote(jobs: PublishJobListItem[], total: number): string | null {
  return total > jobs.length ? `${jobs.length} of them are shown.` : null;
}
