"use client";

import { useCallback, useState, type ReactNode } from "react";
import { checkContentRules } from "@/lib/content-rules";
import { EDITABLE_STATUSES } from "@/lib/content-studio/draft-fields";
import { contentOfEditor, editorValuesOf, sameEditorValues } from "@/lib/content-studio/editor-values";
import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import type { ContentDraftPage, PlanChoices } from "@/services/content-drafts";
import type { DraftMediaPanel } from "@/services/draft-media";
import { DraftChecks } from "./draft-checks";
import { DraftDecision } from "./draft-decision";
import { DraftEditor } from "./draft-editor";
import { DraftMedia, isImageComingFor } from "./draft-media";
import { DraftPreview } from "./draft-preview";
import { ArchiveButton, RegenerateButton } from "./draft-tools";

type DraftWorkspaceProps = {
  draft: Pick<ContentDraftPage, "id" | "platform" | "format" | "status" | "version" | "topic" | "pillar" | "campaign" | "fields" | "editedByHand">;
  isOwner: boolean;
  wordsToAvoid: string[];
  businessName: string | null;
  planChoices: PlanChoices;
  // From the server's review of the saved version (lib/content-studio/review.ts).
  acknowledgmentNeeded: boolean;
  blockingCount: number;
  // The claims of the saved version, rendered on the server (draft-claims.tsx).
  claims: ReactNode;
  // Its image or video from the media library (step 39).
  media: DraftMediaPanel;
  // An owner's approval of the saved version holds (also while it is being published).
  hasApproval: boolean;
  // That approval's owner was made a member or removed since (step 41).
  approvalByFormerOwner: boolean;
  // Scheduling it and what became of its posts (step 41), rendered on the server.
  publishing: ReactNode;
};

// Everything on a draft's page that follows what is typed (step 38): the
// editor, the live checks and preview, and the decisions, which wait while
// the editor holds unsaved changes (they are about the saved text).
export function DraftWorkspace(props: DraftWorkspaceProps) {
  const { draft, isOwner, wordsToAvoid, businessName, planChoices, acknowledgmentNeeded, blockingCount, claims, media, hasApproval, approvalByFormerOwner, publishing } = props;
  const [opened, setOpened] = useState({ version: draft.version, values: editorValuesOf(draft) });
  const [values, setValues] = useState(opened.values);
  // A decision or the AI is at work: the editor holds still until it ends,
  // so nothing typed meanwhile is lost to the version it brings.
  const [busyCount, setBusyCount] = useState(0);
  const trackPending = useCallback((isPending: boolean) => {
    setBusyCount((count) => Math.max(0, count + (isPending ? 1 : -1)));
  }, []);
  // The saved draft moved on (this page's save, or the AI's new text): the
  // editor starts again from it. React's way to reset state when a prop changes.
  if (opened.version !== draft.version) {
    const next = { version: draft.version, values: editorValuesOf(draft) };
    setOpened(next);
    setValues(next.values);
  }
  // Only what a save would change counts (a space at the end doesn't).
  const isDirty = !sameEditorValues(values, opened.values);
  const content = contentOfEditor(draft.platform, draft.format, values);
  const attached = media.attached ? { kind: media.attached.kind, altText: media.attached.altText } : null;
  const issues = checkContentRules(content, { media: attached, wordsToAvoid });
  const isArchived = draft.status === "archived";
  const isEditable = EDITABLE_STATUSES.includes(draft.status);
  // An image being made for this version is attached as the next one: the
  // editor waits, so nothing typed meanwhile is lost to that version.
  const isImageComing = isImageComingFor(media);

  return (
    <>
      <section className="grid gap-4" aria-labelledby="draft-write">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="draft-write" className="text-lg font-semibold">
            Write
          </h2>
          {isEditable && (
            <RegenerateButton
              draftId={draft.id}
              version={draft.version}
              isIdea={draft.status === "idea"}
              editedByHand={draft.editedByHand}
              isDirty={isDirty}
              isScheduled={draft.status === "scheduled"}
              onPendingChange={trackPending}
            />
          )}
        </div>
        {isArchived && <p className="rounded-lg border p-3 text-sm">This draft is archived: restore it below to change it.</p>}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <DraftEditor
            draftId={draft.id}
            version={draft.version}
            platform={draft.platform}
            format={draft.format}
            values={values}
            onChange={setValues}
            onUndo={() => setValues(opened.values)}
            isDirty={isDirty}
            readOnly={!isEditable}
            isBusy={busyCount > 0 || isImageComing}
            changeWarning={changeWarningFor(draft.status)}
            planChoices={planChoices}
          />
          <div className="grid content-start gap-6">
            <DraftMedia
              draftId={draft.id}
              version={draft.version}
              media={media}
              imagePrompt={draft.fields.imagePrompt}
              isDirty={isDirty}
              readOnly={!isEditable}
              isScheduled={draft.status === "scheduled"}
              onPendingChange={trackPending}
            />
            <DraftChecks content={content} issues={issues} wordsToAvoid={wordsToAvoid} />
            <DraftPreview content={content} businessName={businessName} media={media.attached} />
          </div>
        </div>
      </section>

      <section className="grid gap-4" aria-labelledby="draft-approve">
        <h2 id="draft-approve" className="text-lg font-semibold">
          Approve
        </h2>
        {claims}
        {isOwner ? (
          <DraftDecision
            draftId={draft.id}
            version={draft.version}
            status={draft.status}
            hasApproval={hasApproval}
            approvalByFormerOwner={approvalByFormerOwner}
            acknowledgmentNeeded={acknowledgmentNeeded}
            blockingCount={blockingCount}
            isDirty={isDirty}
            onPendingChange={trackPending}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Only owners approve or reject drafts. Nothing is published without an owner&apos;s approval.</p>
        )}
      </section>

      {publishing}

      <section className="grid gap-2" aria-labelledby="draft-archive">
        <h2 id="draft-archive" className="text-lg font-semibold">
          {isArchived ? "Restore" : "Archive"}
        </h2>
        <p className="text-sm text-muted-foreground">{describeArchiving(draft.status)}</p>
        {(isEditable || isArchived) && (
          <ArchiveButton
            draftId={draft.id}
            isArchived={isArchived}
            isScheduled={draft.status === "scheduled"}
            isDirty={isDirty}
            onPendingChange={trackPending}
          />
        )}
      </section>
    </>
  );
}

// What saving a change of content takes away, said once something is typed.
function changeWarningFor(status: ContentDraftStatus): string | null {
  switch (status) {
    case "approved":
    case "failed":
      return "Saving your change makes this a draft again: an owner then approves it again.";
    case "scheduled":
      return "Saving your change makes this a draft again and cancels its scheduled posts: an owner then approves and schedules it again.";
    default:
      return null;
  }
}

// What archiving (or restoring) does to a draft in this status.
function describeArchiving(status: ContentDraftStatus): string {
  switch (status) {
    case "archived":
      return "Restoring makes it a draft again: an owner approves it again before it can be published.";
    case "published":
      return "It went out: a published draft stays here as it was published, and isn't archived.";
    default:
      return "An archived draft stays here, out of the current list. It can't be approved or published until someone restores it, and archiving it cancels its scheduled posts.";
  }
}
