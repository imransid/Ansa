"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_KIND_LABELS, knowledgeKinds, type KnowledgeKind } from "@/lib/knowledge/kinds";
import { KNOWLEDGE_BODY_MAX_LENGTH } from "@/lib/knowledge/limits";

// The fields of the article form (./article-form.tsx), each with its errors
// announced (role="alert") and tied to it (aria-describedby).

export type ArticleFormValues = {
  title: string;
  kind: KnowledgeKind;
  body: string;
  useForSupport: boolean;
  useForMarketing: boolean;
};

export function ArticleKindField({ kind, errors }: { kind: KnowledgeKind; errors?: string[] }) {
  const errorMessage = errors?.[0];
  return (
    <div className="grid gap-2">
      <Label htmlFor="kind">Kind</Label>
      <NativeSelect
        id="kind"
        name="kind"
        key={kind}
        defaultValue={kind}
        className="w-64 max-w-full"
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={errorMessage ? "kind-error" : undefined}
      >
        {knowledgeKinds.map((choice) => (
          <option key={choice} value={choice}>
            {KNOWLEDGE_KIND_LABELS[choice]}
          </option>
        ))}
      </NativeSelect>
      {errorMessage && (
        <p id="kind-error" role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

// The article's text, with how much of the limit it uses. A line break
// counts once, here and on the server.
export function ArticleBodyField({ body, hint, errors }: { body: string; hint: string | null; errors?: string[] }) {
  const [length, setLength] = useState(body.length);
  const errorMessage = errors?.[0];
  const describedBy = ["body-count", hint ? "body-hint" : null, errorMessage ? "body-error" : null].filter(Boolean).join(" ");
  return (
    <div className="grid gap-2">
      <Label htmlFor="body">Text</Label>
      <Textarea
        id="body"
        name="body"
        required
        rows={14}
        maxLength={KNOWLEDGE_BODY_MAX_LENGTH}
        defaultValue={body}
        placeholder={hint ?? undefined}
        onChange={(event) => setLength(event.currentTarget.value.length)}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint && (
        <p id="body-hint" className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <p id="body-count" className="text-xs text-muted-foreground">
        {length.toLocaleString("en-US")} of {KNOWLEDGE_BODY_MAX_LENGTH.toLocaleString("en-US")} characters. Leave a blank
        line between paragraphs: the AI reads an article in pieces of whole paragraphs.
      </p>
      {errorMessage && (
        <p id="body-error" role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

// Who the AI may use the article for, once an owner approves it.
export function ArticleAudienceFields({ useForSupport, useForMarketing }: { useForSupport: boolean; useForMarketing: boolean }) {
  return (
    <fieldset className="grid gap-2 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">Once approved, the AI may use it for</legend>
      <div className="flex items-center gap-2">
        <Checkbox id="useForSupport" name="useForSupport" defaultChecked={useForSupport} />
        <Label htmlFor="useForSupport">Support: shown on matching tickets, and the phone assistant may read it to callers</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="useForMarketing" name="useForMarketing" defaultChecked={useForMarketing} />
        <Label htmlFor="useForMarketing">Marketing: the AI Co-Founder&apos;s posts (not available yet)</Label>
      </div>
    </fieldset>
  );
}
