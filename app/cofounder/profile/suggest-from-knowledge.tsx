"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import Link from "next/link";
import { suggestFactsAction } from "@/app/actions/cofounder";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { FactSuggestionResult } from "@/services/fact-suggestions";

type ArticleChoice = { id: string; title: string };

// "Suggest facts from knowledge" (step 36, owners): pick one approved
// knowledge article meant for support or marketing, the AI reads it and
// proposes the facts it states. Proposals only: they show on the topics
// below, for an owner to confirm or dismiss.
export function SuggestFromKnowledge({ articles }: { articles: ArticleChoice[] }) {
  const [state, suggestAction, isReading] = useActionState(suggestFactsAction, undefined);
  const result = state?.result;
  const problem = result && !result.ok ? (result.errors.fieldErrors?.articleId?.[0] ?? result.errors.message) : undefined;

  // WHY by hand: when <form action> runs an action, React resets the form
  // afterwards, and the menu would jump back to "Pick an article". An action
  // started here, in a transition, runs without that reset.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => suggestAction(formData));
  }

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Suggest facts from knowledge</h2>
      <p className="text-sm text-muted-foreground">
        Pick an approved knowledge article ticked for support or marketing: the AI reads it and proposes the facts it
        states about your business. Nothing changes until an owner confirms a proposal below. A long article is read in
        its first part only.
      </p>
      {articles.length === 0 ? (
        <p className="text-sm">
          There is no approved knowledge article ticked for support or marketing yet. Write or import one on the{" "}
          <Link href="/knowledge" className="underline">
            Knowledge page
          </Link>{" "}
          and approve it, then pick it here.
        </p>
      ) : (
        <form action={suggestAction} onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-0 flex-1 basis-64 gap-2">
            <Label htmlFor="suggest-article">Article</Label>
            <NativeSelect
              id="suggest-article"
              name="articleId"
              required
              defaultValue=""
              className="w-full"
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? "suggest-article-error" : undefined}
            >
              <option value="" disabled>
                Pick an approved article
              </option>
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {article.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline" disabled={isReading}>
            {isReading ? "Reading the article..." : "Suggest facts"}
          </Button>
        </form>
      )}
      {/* Always in the page, so screen readers announce what is put in it. */}
      <div role="status">{!isReading && result?.ok && <SuggestionOutcome result={result} />}</div>
      {problem && (
        <p id="suggest-article-error" role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}

function SuggestionOutcome({ result }: { result: Extract<FactSuggestionResult, { ok: true }> }) {
  const labels = result.proposedTopics.map((topic) => topic.label);
  const partNote = result.readWholeArticle ? "" : " The article is long, so only its first part was read.";
  if (labels.length === 0) {
    return <p className="text-sm text-muted-foreground">The article says nothing new about your business, so nothing was proposed.{partNote}</p>;
  }
  return (
    <p className="rounded-lg border p-3 text-sm">
      Proposed: {labels.join(", ")}. Confirm or dismiss {labels.length === 1 ? "it" : "each one"} below.{partNote}
    </p>
  );
}
