import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { CONTENT_FORMAT_LABELS } from "@/lib/content-studio/formats";
import { describeJobError } from "@/lib/publishing/job-errors";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import type { PublishJobListItem } from "@/services/publishing-pages";
import { JobActions } from "./job-actions";
import { JobStatusBadge } from "./job-status-badge";

type JobListProps = {
  jobs: PublishJobListItem[];
  // Owners get the buttons (the services and /db refuse members anyway).
  canManage: boolean;
  // On a draft's own page the draft isn't named again.
  showDraft: boolean;
};

// Posts of the publishing queue (step 41): the draft and the account, when
// it goes (or went) out, how many tries, why it didn't go out in plain
// words, and an owner's buttons for it.
export function JobList({ jobs, canManage, showDraft }: JobListProps) {
  return (
    <ul className="grid gap-3">
      {jobs.map((job) => {
        const platformLabel = SOCIAL_PLATFORM_LABELS[job.draftPlatform];
        const accountLabel = job.connectionName ? `${platformLabel} (${job.connectionName})` : platformLabel;
        // On a draft's own page its posts differ by account only.
        const postLabel = showDraft ? `“${job.draftTopic}” on ${accountLabel}` : `the post on ${accountLabel}`;
        return (
          <li key={job.id} className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <JobStatusBadge status={job.status} />
              <span className="font-medium wrap-anywhere">{accountLabel}</span>
              {job.connectionIsStandIn && <Badge variant="outline">Development stand-in</Badge>}
              {job.approvalMode === "auto_rule" && <Badge variant="outline">Auto-publish rule</Badge>}
            </div>
            {showDraft && (
              <p className="wrap-anywhere">
                <Link href={`/cofounder/studio/${job.draftId}`} className="font-medium underline">
                  {job.draftTopic}
                </Link>{" "}
                <span className="text-muted-foreground">({CONTENT_FORMAT_LABELS[job.draftFormat]}, version {job.approvedVersion})</span>
              </p>
            )}
            <JobTiming job={job} platformLabel={platformLabel} />
            {canManage && (
              <JobActions
                jobId={job.id}
                status={job.status}
                scheduledAgain={job.scheduledAgain}
                accountLabel={accountLabel}
                postLabel={postLabel}
                platformLabel={platformLabel}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// When it goes or went out, and what is known about how it went.
function JobTiming({ job, platformLabel }: { job: PublishJobListItem; platformLabel: string }) {
  const tries = job.attempts > 1 ? `, tried ${job.attempts} times` : "";
  const reason = job.lastError ? describeJobError(job.lastError, platformLabel) : null;
  switch (job.status) {
    case "queued":
      return (
        <div className="grid gap-1 text-muted-foreground">
          <p>
            Goes out <LocalDateTime iso={job.scheduledFor.toISOString()} />
            {job.runAfter.getTime() > job.scheduledFor.getTime() && (
              <>
                ; next try <LocalDateTime iso={job.runAfter.toISOString()} />
              </>
            )}
            {tries}. Scheduled by {job.createdByName ?? "a former teammate"}.
          </p>
          {reason && <p>{reason}</p>}
          {job.approvalMode === "auto_rule" && job.ruleEnabled === false && (
            <p className="text-destructive">Its auto-publish rule is switched off, so it won&apos;t go out: an owner approves the draft and schedules it again.</p>
          )}
        </div>
      );
    case "publishing":
      return <p className="text-muted-foreground">Going out now{tries}: this page refreshes by itself.</p>;
    case "published":
      return (
        <p className="text-muted-foreground">
          Went out <LocalDateTime iso={(job.publishedAt ?? job.updatedAt).toISOString()} />
          {job.externalUrl && (
            <>
              {" "}
              <a href={job.externalUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Open it on {platformLabel}
              </a>
            </>
          )}
          {job.connectionIsStandIn && " (written to the development stand-in's folder, not published anywhere)"}.
        </p>
      );
    case "canceled":
      return (
        <p className="text-muted-foreground">
          Canceled <LocalDateTime iso={job.updatedAt.toISOString()} />
          {job.canceledByName && <> by {job.canceledByName}</>}.
        </p>
      );
    default:
      return (
        <div className="grid gap-1">
          {reason && <p className="wrap-anywhere">{reason}</p>}
          <p className="text-muted-foreground">
            Was due <LocalDateTime iso={job.scheduledFor.toISOString()} />
            {tries}.
          </p>
          {job.scheduledAgain && <p className="text-muted-foreground">The draft was scheduled on this account again since: that post counts now.</p>}
        </div>
      );
  }
}
