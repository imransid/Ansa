import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { CONTENT_FORMAT_LABELS } from "@/lib/content-studio/formats";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import type { ContentDraftPage } from "@/services/content-drafts";
import { DraftStatusBadge } from "../draft-status-badge";

// The top of a draft's page (step 38): its topic as the page's heading,
// what it is, its version, who made and changed it, and the owner's
// decision: the approval of this version, or the last rejection and its note.
export function DraftSummary({ draft }: { draft: ContentDraftPage }) {
  return (
    <section className="grid gap-3">
      <h1 className="text-xl font-semibold wrap-anywhere">{draft.topic}</h1>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{SOCIAL_PLATFORM_LABELS[draft.platform]}</Badge>
        <Badge variant="outline">{CONTENT_FORMAT_LABELS[draft.format]}</Badge>
        <DraftStatusBadge status={draft.status} />
        <span className="text-muted-foreground">Version {draft.version}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Made on <LocalDateTime iso={draft.createdAt.toISOString()} dateOnly /> by {draft.createdByName ?? "a former teammate"}
        {draft.version > 1 && (
          <>
            , last changed on <LocalDateTime iso={draft.updatedAt.toISOString()} dateOnly /> by {draft.updatedByName ?? "a former teammate"}
          </>
        )}
        {draft.pillar && <>. Content pillar: {draft.pillar}</>}
        {draft.campaign && <>. Campaign: {draft.campaign}</>}
        {draft.plannedFor && (
          <>
            . Planned for <LocalDateTime iso={draft.plannedFor.toISOString()} /> (the calendar)
          </>
        )}
        .
      </p>
      {draft.approval && (
        <p className="rounded-lg border p-3 text-sm">
          Approved by {draft.approval.byName ?? "a former teammate"} on <LocalDateTime iso={draft.approval.at.toISOString()} />, as
          version {draft.approval.version}
          {draft.approval.claimsChecked ? ", after checking its claims" : ""}.
          {!draft.approval.byActiveOwner && " They are no longer an owner of the company, so nothing goes out on this approval until an owner approves it again."}
          {draft.status === "published"
            ? " It went out as that version."
            : " Saving a change, or a new text from the AI, makes it a draft again (and cancels its scheduled posts): an owner then approves it again."}
        </p>
      )}
      {draft.rejection && draft.status !== "approved" && <RejectionNote rejection={draft.rejection} isCurrent={draft.status === "rejected"} />}
    </section>
  );
}

function RejectionNote({ rejection, isCurrent }: { rejection: NonNullable<ContentDraftPage["rejection"]>; isCurrent: boolean }) {
  return (
    <div className="grid gap-1 rounded-lg border p-3 text-sm">
      <p>
        {isCurrent ? "Rejected" : "Last rejected"} by {rejection.byName ?? "a former teammate"} on{" "}
        <LocalDateTime iso={rejection.at.toISOString()} />
        {rejection.note ? ":" : ", without a note."}
      </p>
      {rejection.note && <p className="whitespace-pre-wrap wrap-anywhere">{rejection.note}</p>}
    </div>
  );
}
