import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { describeGenerationError } from "@/lib/media/error-codes";
import { DEV_STAND_IN_PROVIDER, JOB_STATUS_LABELS, MEDIA_KIND_LABELS, type MediaGenerationJobStatus } from "@/lib/media/kinds";
import { mediaLibraryLink } from "@/lib/media/library-link";
import type { GenerationJobListEntry } from "@/services/media-generation-jobs";
import { CancelGenerationButton, StartGenerationNowButton } from "./generation-job-buttons";

const STATUS_BADGES: Record<MediaGenerationJobStatus, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "outline",
  running: "secondary",
  succeeded: "default",
  failed: "destructive",
  canceled: "outline",
};

// The company's newest image and video requests (step 39), newest first:
// what was asked, by whom, for which draft, how it ended (a failure in
// plain words, a success with a link to its card on the library's page
// that shows it), and Cancel or "Start now" where they apply.
// pageOnScreen: the page of the library shown below the list.
export function GenerationJobList({ jobs, pageOnScreen }: { jobs: GenerationJobListEntry[]; pageOnScreen: number }) {
  return (
    <ul className="grid gap-3">
      {jobs.map((job) => (
        <li key={job.id} className="grid gap-2 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGES[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
            <span className="font-medium">{MEDIA_KIND_LABELS[job.kind]}</span>
            {job.provider === DEV_STAND_IN_PROVIDER && <Badge variant="outline">Development stand-in</Badge>}
          </div>
          <p className="wrap-anywhere whitespace-pre-wrap" title={job.prompt.length > 300 ? job.prompt : undefined}>
            &ldquo;{cutForList(job.prompt, 300)}&rdquo;
          </p>
          <p className="text-muted-foreground">
            Asked by {job.requestedByName ?? "a former teammate"} on <LocalDateTime iso={job.createdAt.toISOString()} />
            {job.draftId && (
              <>
                {" "}
                for the draft{" "}
                <Link href={`/cofounder/studio/${job.draftId}`} className="underline wrap-anywhere">
                  {job.draftTopic ?? "(a draft)"}
                </Link>
              </>
            )}
            {job.attempts > 1 && <>, tried {job.attempts} times</>}
            {job.costCents !== null && <>, {describeCost(job.costCents)}</>}.
          </p>
          <JobOutcome job={job} pageOnScreen={pageOnScreen} />
        </li>
      ))}
    </ul>
  );
}

function JobOutcome({ job, pageOnScreen }: { job: GenerationJobListEntry; pageOnScreen: number }) {
  if (job.isStuck) {
    return (
      <div className="grid gap-2">
        <p>
          {job.status === "queued"
            ? "It should have started by now: the run that starts it was cut off."
            : "It has been stuck being made for a while: its run was cut off."}{" "}
          The daily job tries it again, or start it now.
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <StartGenerationNowButton jobId={job.id} />
          {job.status === "queued" && <CancelGenerationButton jobId={job.id} />}
        </div>
      </div>
    );
  }
  switch (job.status) {
    case "queued":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground">Waiting to start: this page refreshes by itself.</p>
          <CancelGenerationButton jobId={job.id} />
        </div>
      );
    case "running":
      return <p className="text-muted-foreground">Being made: this page refreshes by itself.</p>;
    case "failed":
      return <p className="text-destructive">{describeGenerationError(job.lastError ?? "")}</p>;
    case "canceled":
      return <p className="text-muted-foreground">Canceled before it started: nothing was made.</p>;
    case "succeeded":
      return job.assetId ? (
        <p>
          {job.libraryPage === null || job.libraryPage === pageOnScreen ? (
            <a href={`#asset-${job.assetId}`} className="underline">
              See it in the library below
            </a>
          ) : (
            <Link href={mediaLibraryLink(job.assetId, job.libraryPage)} className="underline">
              See it in the library (page {job.libraryPage})
            </Link>
          )}
          {job.draftId && <DraftAttachment job={job} />}.
        </p>
      ) : (
        <p className="text-muted-foreground">What it made was deleted since.</p>
      );
  }
}

// Whether the draft it was asked for has it now.
function DraftAttachment({ job }: { job: GenerationJobListEntry }) {
  if (job.draftMediaAssetId === job.assetId) {
    return <>, attached to its draft</>;
  }
  return <>. It isn&apos;t on its draft: the draft changed after it was asked for, was archived, or got another image since</>;
}

// "free" or "$0.04": what the service charged, as it said.
function describeCost(costCents: number): string {
  return costCents === 0 ? "free" : `cost $${(costCents / 100).toFixed(2)}`;
}

// The prompt as the list shows it: at most this many characters, whole ones.
function cutForList(text: string, max: number): string {
  const characters = [...text];
  return characters.length > max ? `${characters.slice(0, max).join("").trimEnd()}...` : text;
}
