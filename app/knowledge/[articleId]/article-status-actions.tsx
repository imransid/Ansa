"use client";

import { useActionState } from "react";
import {
  approveKnowledgeArticleAction,
  archiveKnowledgeArticleAction,
  deleteKnowledgeArticleAction,
  restoreKnowledgeArticleAction,
} from "@/app/actions/knowledge";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import type { FormErrors } from "@/lib/form-result";
import type { KnowledgeStatus } from "@/lib/knowledge/kinds";

type ArticleStatusActionsProps = {
  articleId: string;
  status: KnowledgeStatus;
  // The revision on screen: "Approve" approves exactly the text shown.
  revision: number;
  title: string;
};

// The owner's buttons on an article's page (step 34). Archiving and
// restoring can be undone, so they don't ask first; deleting asks
// (components/confirm-button.tsx). Each shows its own failure next to it.
export function ArticleStatusActions({ articleId, status, revision, title }: ArticleStatusActionsProps) {
  return (
    <section className="flex flex-wrap items-start gap-3" aria-label="Approve, archive or delete">
      {status === "draft" && (
        <StatusButton
          action={approveKnowledgeArticleAction}
          fields={{ articleId, revision: String(revision) }}
          label="Approve"
          pendingLabel="Approving..."
          primary
        />
      )}
      {status !== "archived" && (
        <StatusButton action={archiveKnowledgeArticleAction} fields={{ articleId }} label="Archive" pendingLabel="Archiving..." />
      )}
      {status === "archived" && (
        <StatusButton action={restoreKnowledgeArticleAction} fields={{ articleId }} label="Restore as draft" pendingLabel="Restoring..." />
      )}
      <ConfirmButton
        action={deleteKnowledgeArticleAction}
        fields={{ articleId }}
        label="Delete"
        accessibleLabel={`Delete ${title}`}
        question={`Delete "${title}"? It is removed for good. Archive it instead to keep it without using it.`}
        confirmLabel="Yes, delete"
        pendingLabel="Deleting..."
      />
    </section>
  );
}

type StatusButtonProps = {
  action: (previous: FormErrors | undefined, formData: FormData) => Promise<FormErrors | undefined>;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  primary?: boolean;
};

function StatusButton({ action, fields, label, pendingLabel, primary = false }: StatusButtonProps) {
  const [errors, formAction, isPending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid max-w-sm gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant={primary ? "default" : "outline"} disabled={isPending}>
        {isPending ? pendingLabel : label}
      </Button>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}
