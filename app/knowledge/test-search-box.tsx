"use client";

import { useActionState } from "react";
import { testKnowledgeSearchAction } from "@/app/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CALL_ANSWER_MAX_CHARACTERS, CALL_ANSWER_MAX_HITS } from "@/lib/knowledge/call-answer";
import { KNOWLEDGE_QUESTION_MAX_LENGTH } from "@/lib/knowledge/limits";

// "Test what the AI finds" (step 34): type what a customer might ask and see
// the approved support articles the AI would get for it, piece by piece, as
// it would read them, and the one line the phone assistant gets during a
// call (step 35). A server action, not a link: a question can hold a
// customer's details, and a URL would keep them in the browser history and
// the host's logs. Nothing is saved or sent to the AI.
export function TestSearchBox() {
  const [state, action, isSearching] = useActionState(testKnowledgeSearchAction, undefined);
  const problem = state?.errors?.fieldErrors?.question?.[0] ?? state?.errors?.message;

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Test what the AI finds</h2>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="question">A question a customer might ask</Label>
          <Input
            id="question"
            name="question"
            required
            maxLength={KNOWLEDGE_QUESTION_MAX_LENGTH}
            defaultValue={state?.question}
            placeholder="How long does a refund take?"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "question-error" : undefined}
          />
        </div>
        <Button type="submit" variant="outline" disabled={isSearching}>
          {isSearching ? "Searching..." : "Search"}
        </Button>
        {problem && (
          <p id="question-error" role="alert" className="w-full text-sm text-destructive">
            {problem}
          </p>
        )}
      </form>
      {state?.slice && <SearchResults hits={state.slice.hits} promptText={state.slice.text} callAnswer={state.callAnswer} />}
    </section>
  );
}

type SearchResultsProps = {
  hits: { title: string; text: string }[];
  promptText: string;
  callAnswer?: string;
};

function SearchResults({ hits, promptText, callAnswer }: SearchResultsProps) {
  if (hits.length === 0) {
    return (
      <div role="status" className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          No approved support article matches. Drafts, archived articles and articles not used for support are never
          searched.
        </p>
        {callAnswer && <PhoneAnswer text={callAnswer} />}
      </div>
    );
  }
  return (
    <div role="status" className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        The AI would get {hits.length === 1 ? "this piece" : `these ${hits.length} pieces`}, best match first:
      </p>
      <ol className="grid gap-3">
        {hits.map((hit, index) => (
          <li key={index} className="grid gap-1 rounded-lg border p-3 text-sm">
            <p className="font-medium wrap-anywhere">{hit.title}</p>
            <p className="whitespace-pre-line wrap-anywhere text-muted-foreground">{hit.text}</p>
          </li>
        ))}
      </ol>
      <details className="text-sm">
        <summary className="cursor-pointer">Show the exact text the AI gets</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-muted p-3 text-xs whitespace-pre-wrap wrap-anywhere">{promptText}</pre>
      </details>
      {callAnswer && <PhoneAnswer text={callAnswer} />}
    </div>
  );
}

// What the phone assistant gets for this question during a call (step 35):
// one line, from the best few pieces only.
function PhoneAnswer({ text }: { text: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">Show the exact line the phone assistant gets during a call</summary>
      <p className="mt-2 text-muted-foreground">
        At most the best {CALL_ANSWER_MAX_HITS} pieces, in {CALL_ANSWER_MAX_CHARACTERS.toLocaleString("en-US")} characters:
      </p>
      <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-muted p-3 text-xs whitespace-pre-wrap wrap-anywhere">{text}</pre>
    </details>
  );
}
