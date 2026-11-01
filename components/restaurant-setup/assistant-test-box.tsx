"use client";

import { useActionState } from "react";
import { ConciergeBell } from "lucide-react";
import { testAssistantAction } from "@/app/actions/assistant";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REPLY_MAX_LENGTH } from "@/lib/conversations";

// "Test your assistant" (step 49, owners): type what a customer might write,
// and see what ansa would answer, or that it would hand over and why.
// Nothing is saved or sent. React empties the box after the action runs;
// the answer below names the question, so nothing is lost.
export function AssistantTestBox({ personal = false }: { personal?: boolean }) {
  const [state, action, isTesting] = useActionState(testAssistantAction, undefined);
  const errors = state && !state.ok ? state.errors : undefined;
  return (
    <form action={action} className="grid gap-3">
      <Label htmlFor="assistant-test">Someone writes</Label>
      <Textarea
        id="assistant-test"
        name="text"
        rows={2}
        required
        maxLength={REPLY_MAX_LENGTH}
        placeholder={personal ? "Hi! Are you free for a call on Tuesday?" : "Are you open tonight? Do you have anything vegan?"}
        aria-invalid={errors?.fieldErrors?.text ? true : undefined}
        aria-describedby={errors?.fieldErrors?.text ? "assistant-test-errors" : undefined}
      />
      {errors?.fieldErrors?.text && (
        <p id="assistant-test-errors" role="alert" className="text-sm text-destructive">
          {errors.fieldErrors.text[0]}
        </p>
      )}
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={isTesting} className="justify-self-start">
        {isTesting ? "Asking..." : "See ansa's answer"}
      </Button>
      {state?.ok && (
        <div className="grid gap-2 rounded-2xl bg-secondary p-4 text-sm" aria-live="polite">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ConciergeBell aria-hidden className="size-3.5 text-link" />
            {state.outcome === "reply" ? "ansa would answer" : state.outcome === "handover" ? "ansa would hand over to you" : "ansa would not answer"}
          </span>
          {state.outcome === "reply" && <p className="whitespace-pre-line">{state.text}</p>}
          {state.outcome === "handover" && (
            <>
              <p className="whitespace-pre-line">{state.holdingReply}</p>
              <p className="text-xs text-muted-foreground">Why: {state.why} You would get an alert.</p>
            </>
          )}
          {state.outcome === "no_reply" && <p>The message needs no answer (a thank you, an emoji).</p>}
        </div>
      )}
    </form>
  );
}
