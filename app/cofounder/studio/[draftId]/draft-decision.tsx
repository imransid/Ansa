"use client";

import { useActionState, useState } from "react";
import { approveDraftAction, rejectDraftAction } from "@/app/actions/content-studio";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { APPROVABLE_STATUSES, REJECTABLE_STATUSES } from "@/lib/content-studio/draft-fields";
import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import { REJECTION_NOTE_MAX_LENGTH } from "@/lib/content-studio/limits";
import { useReportPending } from "@/lib/report-pending";

type DraftDecisionProps = {
  draftId: string;
  // The saved version on screen: Approve and Reject decide about exactly it.
  version: number;
  status: ContentDraftStatus;
  // An owner's approval of this version holds already (also while it is being published).
  hasApproval: boolean;
  // That approval's owner was made a member or removed since: nothing goes
  // out on it (step 41), so another owner approves this version again.
  approvalByFormerOwner: boolean;
  acknowledgmentNeeded: boolean;
  // Problems of the saved version that block approval (the server decides again).
  blockingCount: number;
  // Unsaved changes in the editor: the decision would be about other words.
  isDirty: boolean;
  // Told when a decision starts and ends: the editor holds still meanwhile.
  onPendingChange: (isPending: boolean) => void;
};

// An owner's Approve and Reject (step 38). Approve needs no blocking
// problem, and "I checked these claims" when a claim isn't backed or nobody
// listed them; both are checked again in the transaction that approves.
export function DraftDecision(props: DraftDecisionProps) {
  const { status, isDirty, blockingCount, hasApproval, approvalByFormerOwner } = props;
  const canApprove = (APPROVABLE_STATUSES.includes(status) && !hasApproval) || approvalByFormerOwner;
  const canReject = REJECTABLE_STATUSES.includes(status);
  if (!canApprove && !canReject) {
    return <p className="text-sm text-muted-foreground">{describeWhyNoDecision(status)}</p>;
  }
  return (
    <div className="grid gap-4">
      {isDirty && <p className="text-sm">Save or undo your changes first: Approve and Reject decide about the saved text.</p>}
      {approvalByFormerOwner && (
        <p className="text-sm">The owner who approved this version is no longer an owner of the company, so nothing goes out on that approval: approve it again to publish it.</p>
      )}
      {canApprove && blockingCount > 0 && (
        <p className="text-sm">Fix the problems marked &ldquo;Blocks approval&rdquo; under Checks, and save, before approving.</p>
      )}
      <div className="flex flex-wrap items-start gap-6">
        {canApprove && <ApproveForm {...props} disabled={isDirty || blockingCount > 0} />}
        {canReject && <RejectForm {...props} disabled={isDirty} />}
      </div>
    </div>
  );
}

function ApproveForm({ draftId, version, acknowledgmentNeeded, disabled, onPendingChange }: DraftDecisionProps & { disabled: boolean }) {
  const [errors, approveAction, isApproving] = useActionState(approveDraftAction, undefined);
  useReportPending(isApproving, onPendingChange);
  return (
    <form action={approveAction} className="grid max-w-md gap-2">
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="version" value={version} />
      {acknowledgmentNeeded && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox name="claimsChecked" className="mt-0.5" disabled={disabled} />
          <span>I checked these claims: everything this text says about the business is true.</span>
        </label>
      )}
      <Button type="submit" className="justify-self-start" disabled={disabled || isApproving}>
        {isApproving ? "Approving..." : `Approve version ${version}`}
      </Button>
      {errors?.message && !isApproving && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {errors.message}
        </p>
      )}
    </form>
  );
}

// Reject opens a note first (optional), kept in state so a refusal can't lose it.
function RejectForm({ draftId, version, status, disabled, onPendingChange }: DraftDecisionProps & { disabled: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [errors, rejectAction, isRejecting] = useActionState(rejectDraftAction, undefined);
  useReportPending(isRejecting, onPendingChange);
  if (!isOpen) {
    return (
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setIsOpen(true)}>
        Reject...
      </Button>
    );
  }
  const noteError = errors?.fieldErrors?.note?.[0];
  return (
    <form action={rejectAction} className="grid w-full max-w-md gap-2">
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="version" value={version} />
      {status === "scheduled" && <p className="text-sm">Rejecting cancels this draft&apos;s scheduled posts (a post going out right now still goes).</p>}
      <Label htmlFor="rejection-note">What should change? (optional)</Label>
      <Textarea
        id="rejection-note"
        name="note"
        rows={3}
        maxLength={REJECTION_NOTE_MAX_LENGTH}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-invalid={noteError ? true : undefined}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={disabled || isRejecting}>
          {isRejecting ? "Rejecting..." : `Reject version ${version}`}
        </Button>
        <Button type="button" variant="ghost" disabled={isRejecting} onClick={() => setIsOpen(false)}>
          Cancel
        </Button>
      </div>
      {(noteError ?? errors?.message) && !isRejecting && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {noteError ?? errors?.message}
        </p>
      )}
    </form>
  );
}

function describeWhyNoDecision(status: ContentDraftStatus): string {
  switch (status) {
    case "idea":
      return "Nothing is written yet: write the text, or let the AI write it, then an owner can approve it.";
    case "archived":
      return "An archived draft can't be approved or rejected: restore it first.";
    case "published":
      return "It went out, and stays as it was published. For a new post, start a new draft.";
    default:
      return "This draft can't be approved or rejected now.";
  }
}
