import Link from "next/link";
import { RefreshWhilePending } from "@/components/refresh-while-pending";
import { CONTENT_FORMAT_PLURALS } from "@/lib/content-studio/formats";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import type { ContentDraftPage } from "@/services/content-drafts";
import type { DraftPublishing } from "@/services/draft-publishing";
import { ActivityList } from "../../publishing/activity-list";
import { JobList } from "../../publishing/job-list";
import { ScheduleForm } from "./schedule-form";

type DraftPublishingSectionProps = {
  draft: Pick<ContentDraftPage, "id" | "platform" | "format" | "status" | "version" | "approval" | "plannedFor">;
  publishing: DraftPublishing;
};

// A draft's "Publish" section (step 41): scheduling it to the company's
// accounts of its platform (owners), what became of each post, and the
// draft's own activity. Scheduling decides again with the draft's row
// locked (db/publish-scheduling.ts), and each post is checked once more
// right before it goes out.
export function DraftPublishingSection({ draft, publishing }: DraftPublishingSectionProps) {
  return (
    <section className="grid gap-4" aria-labelledby="draft-publish">
      <RefreshWhilePending isPending={publishing.isBusy} />
      <h2 id="draft-publish" className="text-lg font-semibold">
        Publish
      </h2>
      <SchedulePart draft={draft} publishing={publishing} />
      {publishing.jobs.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Posts of this draft</h3>
          <JobList jobs={publishing.jobs} canManage={publishing.canManage} showDraft={false} />
        </div>
      )}
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Activity</h3>
        <ActivityList entries={publishing.activity} linkDrafts={false} emptyText="Nothing has happened to this draft yet beyond its writing." />
      </div>
    </section>
  );
}

// The schedule form, or in plain words why there is none.
function SchedulePart({ draft, publishing }: DraftPublishingSectionProps) {
  const platform = SOCIAL_PLATFORM_LABELS[draft.platform];
  if (!publishing.canManage) {
    return <p className="text-sm text-muted-foreground">Only owners schedule posts. Nothing is published without an owner&apos;s approval.</p>;
  }
  if (["idea", "rejected", "archived"].includes(draft.status)) {
    return <p className="text-sm text-muted-foreground">An idea, a rejected or an archived draft can&apos;t go out: write it and have an owner approve it first.</p>;
  }
  if (!publishing.formatPublishable) {
    return (
      <p className="text-sm text-muted-foreground">
        ansa can&apos;t publish {CONTENT_FORMAT_PLURALS[draft.format]} to {platform} yet.
      </p>
    );
  }
  if (draft.approval && !draft.approval.byActiveOwner) {
    return <p className="text-sm">The owner who approved this version is no longer an owner of the company: an owner approves it again (above), then it can be scheduled here.</p>;
  }
  const ruleLabel = publishing.coveringRule ? `${platform}, ${publishing.coveringRule.pillar ? `pillar “${publishing.coveringRule.pillar}”` : "every pillar"}` : null;
  if (!draft.approval && !ruleLabel) {
    return <p className="text-sm text-muted-foreground">An owner approves this version first; then it can be scheduled here.</p>;
  }
  const connected = publishing.accounts.filter((account) => account.status === "connected");
  if (connected.length === 0 || connected.every((account) => account.hasLiveJob)) {
    return (
      <p className="text-sm">
        {connected.length === 0
          ? `No ${platform} account is connected.`
          : `This draft is scheduled, published or waiting for a check on every connected ${platform} account.`}{" "}
        To send it to {connected.length === 0 ? "one" : "another"}, connect it on the{" "}
        <Link href="/cofounder/accounts" className="underline">
          Accounts
        </Link>{" "}
        page.
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {draft.approval
          ? `Version ${draft.version}, as approved, goes to the accounts you pick. Changing the draft before then takes the approval away and cancels what is scheduled.`
          : `This version has no owner's approval, but an auto-publish rule covers it: it goes out only if it still breaks no rule and every claim is backed when it is sent.`}
      </p>
      <ScheduleForm
        draftId={draft.id}
        version={draft.version}
        accounts={publishing.accounts}
        ruleLabel={draft.approval ? null : ruleLabel}
        plannedFor={draft.plannedFor ? draft.plannedFor.toISOString() : null}
      />
    </div>
  );
}
