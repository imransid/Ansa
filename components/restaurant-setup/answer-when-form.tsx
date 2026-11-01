"use client";

import { saveAnswerWhenAction } from "@/app/actions/away";
import { ANSWER_WHEN_LABELS, type AnswerWhen } from "@/lib/assistant/availability";
import { Choice, Choices } from "./assistant-settings-form";
import { SectionForm } from "./section-form";

// Settings → Assistant → When ansa answers (step 51, owners): every message,
// or only while you're away (your away hours below, "I'm away" on Home, or
// no answer from you in time).
export function AnswerWhenForm({ answerWhen }: { answerWhen: AnswerWhen }) {
  return (
    <SectionForm action={saveAnswerWhenAction} place="settings">
      {(state) => (
        <Choices legend="Answer messages" name="answerWhen" errors={state?.errors?.fieldErrors?.answerWhen}>
          <Choice name="answerWhen" value="always" defaultChecked={answerWhen === "always"} label={ANSWER_WHEN_LABELS.always}>
            Every message, at once. For a business answering its customers.
          </Choice>
          <Choice name="answerWhen" value="when_away" defaultChecked={answerWhen === "when_away"} label={ANSWER_WHEN_LABELS.when_away}>
            At your away hours below, after you press &ldquo;I&apos;m away&rdquo; on Home, or when you haven&apos;t answered in time. The rest
            you answer yourself.
          </Choice>
        </Choices>
      )}
    </SectionForm>
  );
}
