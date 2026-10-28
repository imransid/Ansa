"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { answerInterviewAction, type InterviewAnswerState } from "@/app/actions/cofounder";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { INTERVIEW_ANSWER_MAX_LENGTH } from "@/lib/cofounder/limits";
import type { InterviewAnswerResult } from "@/services/onboarding-interview";

type AnswerFormProps = {
  // Only while the page shows the first question: the topic it asks about
  // ("none": it asks for anything to add), so that question is saved with
  // the answer word for word.
  openingTopic?: string;
};

// The owner's answer box (step 36). Its text is kept in state, not left to
// the browser: React empties a form's own fields after every submit, and an
// answer must not be lost to a refusal ("Too many..."). It is emptied only
// once the answer is saved, and can't be typed in while the AI reads it.
export function AnswerForm({ openingTopic }: AnswerFormProps) {
  const [answer, setAnswer] = useState("");

  async function send(previous: InterviewAnswerState | undefined, formData: FormData): Promise<InterviewAnswerState> {
    const state = await answerInterviewAction(previous, formData);
    if (state.result?.ok) {
      setAnswer("");
    }
    return state;
  }

  const [state, formAction, isSending] = useActionState(send, undefined);
  const result = state?.result;
  const problem = result && !result.ok ? (result.errors.fieldErrors?.answer?.[0] ?? result.errors.message) : undefined;

  return (
    <form action={formAction} className="grid gap-2">
      {openingTopic && <input type="hidden" name="openingTopic" value={openingTopic} />}
      {/* Always in the page, so screen readers announce what is put in it. */}
      <div role="status" className="grid gap-2">
        {isSending && <SendingAnswer text={answer} />}
        {!isSending && result?.ok && <AnswerOutcome result={result} />}
      </div>
      <Label htmlFor="interview-answer">Your answer</Label>
      <Textarea
        id="interview-answer"
        name="answer"
        required
        rows={4}
        maxLength={INTERVIEW_ANSWER_MAX_LENGTH}
        readOnly={isSending}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        aria-describedby={problem ? "interview-answer-help interview-answer-error" : "interview-answer-help"}
        aria-invalid={problem ? true : undefined}
      />
      <p id="interview-answer-help" className="text-xs text-muted-foreground">
        Stored encrypted and read by the AI to propose facts. Leave out passwords, card numbers and your customers&apos;
        details.
      </p>
      {problem && (
        <p id="interview-answer-error" role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <Button type="submit" className="justify-self-start" disabled={isSending}>
        {isSending ? "Sending..." : "Send answer"}
      </Button>
    </form>
  );
}

// The answer as it was sent, where it will show in the conversation, while
// the AI reads it (up to a minute or so).
function SendingAnswer({ text }: { text: string }) {
  return (
    <>
      <p className="max-w-[85%] justify-self-end rounded-lg border bg-muted p-3 text-sm whitespace-pre-wrap wrap-anywhere">{text}</p>
      <p className="text-sm text-muted-foreground">The Co-Founder is reading your answer. This can take up to a minute.</p>
    </>
  );
}

// What became of the answer just saved: the facts proposed from it, or that
// the AI couldn't read it (nothing was taken from it).
function AnswerOutcome({ result }: { result: Extract<InterviewAnswerResult, { ok: true }> }) {
  if (!result.aiReadAnswer) {
    const topic = result.fixedQuestionTopic;
    return (
      <p className="rounded-lg border p-3 text-sm">
        The AI couldn&apos;t read your answer just now, so nothing was taken from it.{" "}
        {topic ? (
          <>
            You can fill in &ldquo;{topic.label}&rdquo; yourself on the{" "}
            <Link href={`/cofounder/profile#topic-${topic.topic}`} className="underline">
              Profile page
            </Link>
            .
          </>
        ) : (
          <>
            You can type any fact yourself on the{" "}
            <Link href="/cofounder/profile" className="underline">
              Profile page
            </Link>
            .
          </>
        )}
      </p>
    );
  }
  if (result.proposedTopics.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing new was proposed from this answer.</p>;
  }
  return (
    <p className="rounded-lg border p-3 text-sm">
      Proposed from your answer: {result.proposedTopics.map((topic) => topic.label).join(", ")}. Confirm{" "}
      {result.proposedTopics.length === 1 ? "it" : "them"} on the{" "}
      <Link href="/cofounder/profile" className="underline">
        Profile page
      </Link>
      .
    </p>
  );
}
