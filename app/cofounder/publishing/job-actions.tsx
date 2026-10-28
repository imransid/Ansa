"use client";

import { useActionState } from "react";
import {
  cancelPublishJobAction,
  markJobNotPublishedAction,
  markJobPublishedAction,
  publishJobNowAction,
  retryPublishJobAction,
} from "@/app/actions/publishing";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormErrors } from "@/lib/form-result";
import type { PublishJobStatus } from "@/lib/publishing/kinds";
import { POST_URL_MAX_LENGTH } from "@/lib/publishing/limits";

type JobActionsProps = {
  jobId: string;
  status: PublishJobStatus;
  // A failed post whose account has the draft again since: no Retry.
  scheduledAgain: boolean;
  // "LinkedIn (Ana Baker)": what the questions name.
  accountLabel: string;
  // "“Our lunch menu” on LinkedIn (Ana Baker)": what screen readers hear each
  // button act on, after its own words, as every post has the same buttons.
  postLabel: string;
  platformLabel: string;
};

type ActionOfJob = (previous: FormErrors | undefined, formData: FormData) => Promise<FormErrors | undefined>;

// An owner's buttons for one post (step 41): a waiting one can go out now
// or be canceled; one that failed can be tried again (unless its account
// has the draft again since); one that needs attention is checked on the
// platform first, then marked published (with its address, if they have
// it) or not published, or tried again after a warning that it may post
// twice. Canceling and marking ask first.
export function JobActions({ jobId, status, scheduledAgain, accountLabel, postLabel, platformLabel }: JobActionsProps) {
  const fields = { jobId };
  switch (status) {
    case "queued":
      return (
        <div className="flex flex-wrap items-start gap-2">
          <JobButton action={publishJobNowAction} fields={fields} label="Publish now" accessibleLabel={`Publish now: ${postLabel}`} pendingLabel="Sending..." />
          <ConfirmButton
            action={cancelPublishJobAction}
            fields={fields}
            label="Cancel"
            accessibleLabel={`Cancel: ${postLabel}`}
            question={`Cancel this post? It won't go out on ${accountLabel}. Schedule it again to send it later.`}
            confirmLabel="Yes, cancel it"
            pendingLabel="Canceling..."
          />
        </div>
      );
    case "failed":
      if (scheduledAgain) {
        return null;
      }
      return <JobButton action={retryPublishJobAction} fields={fields} label="Try again now" accessibleLabel={`Try again now: ${postLabel}`} pendingLabel="Sending..." />;
    case "needs_attention":
      return (
        <div className="grid gap-3">
          <p className="text-sm">
            Look for the post on {platformLabel} first. If it is there, mark it as published; if it isn&apos;t, mark it as not published, or
            try again.
          </p>
          <MarkPublishedForm jobId={jobId} platformLabel={platformLabel} postLabel={postLabel} />
          <div className="flex flex-wrap items-start gap-2">
            <ConfirmButton
              action={markJobNotPublishedAction}
              fields={fields}
              label="Mark as not published"
              accessibleLabel={`Mark as not published: ${postLabel}`}
              question={`You checked ${platformLabel} and the post isn't there? It is then marked as failed, and can be tried again.`}
              confirmLabel="Yes, it isn't there"
              pendingLabel="Saving..."
            />
            <ConfirmButton
              action={retryPublishJobAction}
              fields={fields}
              label="Try again now"
              accessibleLabel={`Try again now: ${postLabel}`}
              question={`It may already be on ${platformLabel}: trying again could post it twice. Only go on after checking that it isn't there.`}
              confirmLabel="Yes, try again"
              pendingLabel="Sending..."
            />
          </div>
        </div>
      );
    default:
      return null;
  }
}

// "Mark as published", with the post's address if the owner has it.
function MarkPublishedForm({ jobId, platformLabel, postLabel }: { jobId: string; platformLabel: string; postLabel: string }) {
  const [errors, formAction, isPending] = useActionState(markJobPublishedAction, undefined);
  const urlError = isPending ? undefined : errors?.fieldErrors?.postUrl?.[0];
  const message = isPending ? undefined : errors?.message;
  const inputId = `post-url-${jobId}`;
  return (
    <form action={formAction} className="grid max-w-lg gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Label htmlFor={inputId}>The post&apos;s address on {platformLabel} (optional)</Label>
      <Input
        id={inputId}
        name="postUrl"
        type="url"
        inputMode="url"
        autoComplete="off"
        maxLength={POST_URL_MAX_LENGTH}
        defaultValue={errors?.values?.postUrl ?? ""}
        placeholder="https://"
        aria-invalid={urlError ? true : undefined}
        aria-describedby={urlError ? `${inputId}-error` : undefined}
      />
      {urlError && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
          {urlError}
        </p>
      )}
      <Button type="submit" size="sm" variant="outline" className="justify-self-start" aria-label={`Mark as published: ${postLabel}`} disabled={isPending}>
        {isPending ? "Saving..." : "Mark as published"}
      </Button>
      {message && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {message}
        </p>
      )}
    </form>
  );
}

type JobButtonProps = { action: ActionOfJob; fields: Record<string, string>; label: string; accessibleLabel: string; pendingLabel: string };

// One button that runs one action, with its failure next to it.
function JobButton({ action, fields, label, accessibleLabel, pendingLabel }: JobButtonProps) {
  const [errors, formAction, isPending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid max-w-sm gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant="outline" className="justify-self-start" aria-label={accessibleLabel} disabled={isPending}>
        {isPending ? pendingLabel : label}
      </Button>
      {errors?.message && !isPending && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {errors.message}
        </p>
      )}
    </form>
  );
}
