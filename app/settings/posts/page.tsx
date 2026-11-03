import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { postNowAction } from "@/app/actions/autopost";
import { ActionButton } from "@/components/action-button";
import { AutopostForm } from "@/components/autopost/autopost-form";
import { LocalDateTime } from "@/components/local-date-time";
import { PageLoading } from "@/components/page-loading";
import { RefreshWhilePending } from "@/components/refresh-while-pending";
import { StatusDot } from "@/components/status-dot";
import { POST_KIND_LABELS } from "@/lib/autopost/brain";
import { AUTOPOST_FREQUENCY_LABELS } from "@/lib/autopost/schedule";
import { SKIP_REASON_TEXT } from "@/lib/autopost/slots";
import { getAutopostPageFromCore } from "@/lib/core-views/autopost";
import { requireSessionContext } from "@/lib/session";
import { PostedList } from "./posted-list";

export const metadata: Metadata = { title: "Posts for me - ansa" };

// "Post one now" asks the AI and then sends the post, within this page's
// time limit, not the host's default.
export const maxDuration = 300;

// Settings → Posts for me (step 54): ansa posts on the business's Facebook
// Page by itself. One switch, the next posts, and how the last ones did.
export default function PostsForMePage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
          &larr; Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Posts for me</h1>
        <p className="text-muted-foreground">
          ansa plans, writes and posts on your Facebook Page: what you offer, behind the scenes, special days, questions for your followers. It
          learns what your followers like, and you never give it a topic.
        </p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <PostsForMe />
      </Suspense>
    </main>
  );
}

async function PostsForMe() {
  await requireSessionContext("/settings/posts");
  const page = await getAutopostPageFromCore();
  return (
    <>
      {/* "Post one now" (or the next planned post) shows as posted by itself. */}
      <RefreshWhilePending isPending={page.isBusy} />
      {page.pages.length === 0 && (
        <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
          Connect your Facebook Page first.{" "}
          <Link href="/settings/channels" className="font-medium underline">
            Settings → Connections
          </Link>
        </p>
      )}
      {!page.timeZone && (
        <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
          Set your time zone first.{" "}
          <Link href="/settings/business" className="font-medium underline">
            Settings → What it knows
          </Link>
        </p>
      )}
      <section aria-labelledby="now-heading" className="grid gap-3 rounded-2xl border bg-card p-5">
        <h2 id="now-heading" className="text-lg font-semibold">
          {page.enabled ? "ansa is posting for you" : "Posting is off"}
        </h2>
        {page.enabled ? (
          <>
            <p className="text-sm text-muted-foreground">
              {AUTOPOST_FREQUENCY_LABELS[page.frequency]}, at {page.time}, on {page.pages.join(", ") || "your Facebook Page"}.{" "}
              {page.mode === "automatic" ? "Each post goes out by itself." : "Each post waits for your approval."}
            </p>
            {page.nextTimes.length > 0 && (
              <p className="text-sm">
                Next: {page.nextTimes.map((time, index) => (
                  <span key={time.toISOString()}>
                    {index > 0 ? ", " : ""}
                    <LocalDateTime iso={time.toISOString()} />
                  </span>
                ))}
              </p>
            )}
            {page.canManage && (
              <ActionButton
                action={postNowAction}
                fields={{}}
                label="Post one now"
                accessibleLabel="Write a post now and send it"
                pendingLabel="ansa is writing a post..."
                doneText="Written: see where it is in ansa's posts below."
              />
            )}
          </>
        ) : (
          <StatusDot tone="quiet">Switch it on below, and ansa takes care of your Page.</StatusDot>
        )}
      </section>
      {page.canManage ? (
        <AutopostForm enabled={page.enabled} frequency={page.frequency} time={page.time} mode={page.mode} />
      ) : (
        <p className="text-sm text-muted-foreground">Only owners change this.</p>
      )}
      <section aria-labelledby="posted-heading" className="grid gap-3 border-t pt-6">
        <h2 id="posted-heading" className="text-lg font-semibold">
          ansa&apos;s posts
        </h2>
        <PostedList slots={page.slots} kindLabels={POST_KIND_LABELS} skipText={SKIP_REASON_TEXT} />
      </section>
    </>
  );
}
