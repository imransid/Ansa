"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { createKnowledgeArticleAction, editKnowledgeArticleAction } from "@/app/actions/knowledge";
import { FormField } from "@/components/form-field";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import type { SaveState } from "@/lib/form-result";
import { KNOWLEDGE_TITLE_MAX_LENGTH, NO_CUSTOMER_DATA_NOTICE } from "@/lib/knowledge/limits";
import { ArticleAudienceFields, ArticleBodyField, ArticleKindField, type ArticleFormValues } from "./article-fields";

export type { ArticleFormValues };

type ArticleFormProps =
  // "New article". fromTicket: the solved ticket "Save as knowledge" came from.
  | { mode: "create"; initial: ArticleFormValues; fromTicket: number | null }
  // An article's page: the revision it showed, so a save never overwrites a
  // change someone made since.
  | { mode: "edit"; initial: ArticleFormValues; articleId: string; revision: number };

// The help under the text of an article written from a solved ticket.
const SOLUTION_HINT = "Write the fix in general terms. No customer names, emails, phone numbers or account details.";

// The article form for writing and editing (step 34). What was typed is
// never lost to an error: the action runs from onSubmit, in a transition, so
// React doesn't empty the form afterwards (as in the "New ticket" form).
export function ArticleForm(props: ArticleFormProps) {
  // What the form opened with. Its fields start from it and keep it when the
  // page refreshes after a save (React would move an untouched field to the
  // new value).
  const [initial] = useState(props.initial);
  const [changedSinceSave, setChangedSinceSave] = useState(false);

  async function save(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
    if (props.mode === "edit") {
      return editKnowledgeArticleAction(undefined, formData);
    }
    // On success this opens the new article (a redirect), so it never returns.
    const errors = await createKnowledgeArticleAction(undefined, formData);
    return { errors };
  }
  const [state, saveAction, isSaving] = useActionState(save, undefined);
  const fieldErrors = state?.errors?.fieldErrors;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setChangedSinceSave(false);
    startTransition(() => saveAction(formData));
  }

  const fromTicket = props.mode === "create" ? props.fromTicket : null;
  return (
    <form action={saveAction} onSubmit={submit} onInput={() => setChangedSinceSave(true)} className="grid max-w-3xl gap-4">
      {props.mode === "edit" && (
        <>
          <input type="hidden" name="articleId" value={props.articleId} />
          <input type="hidden" name="revision" value={props.revision} />
        </>
      )}
      {fromTicket !== null && <input type="hidden" name="fromTicket" value={fromTicket} />}
      <p className="rounded-lg border p-3 text-sm">{NO_CUSTOMER_DATA_NOTICE}</p>
      {state?.errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
      <FormField
        name="title"
        label="Title"
        autoComplete="off"
        defaultValue={initial.title}
        maxLength={KNOWLEDGE_TITLE_MAX_LENGTH}
        errors={fieldErrors?.title}
      />
      <ArticleKindField kind={initial.kind} errors={fieldErrors?.kind} />
      <ArticleBodyField body={initial.body} hint={initial.kind === "solution" ? SOLUTION_HINT : null} errors={fieldErrors?.body} />
      <ArticleAudienceFields useForSupport={initial.useForSupport} useForMarketing={initial.useForMarketing} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isSaving}>
          {submitLabel(props.mode, isSaving)}
        </Button>
        {props.mode === "edit" && <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />}
      </div>
    </form>
  );
}

function submitLabel(mode: ArticleFormProps["mode"], isSaving: boolean): string {
  if (mode === "create") {
    return isSaving ? "Saving..." : "Save as draft";
  }
  return isSaving ? "Saving..." : "Save changes";
}
