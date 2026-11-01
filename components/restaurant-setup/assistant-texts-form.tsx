"use client";

import { saveAssistantSectionAction } from "@/app/actions/restaurant-setup";
import { HOLDING_REPLY_MAX_LENGTH, INSTRUCTIONS_MAX_LENGTH } from "@/lib/restaurant-setup";
import { SectionForm } from "./section-form";
import { TextAreaField } from "./text-area-field";

// Setup step 5: the owner's own instructions for the assistant, and what a
// customer gets when it hands over to the team. The reply mode stays
// Automatic; Settings → Assistant changes it.
export function AssistantTextsForm({ backHref, instructions, holdingReply }: { backHref: string; instructions: string; holdingReply: string }) {
  return (
    <SectionForm action={saveAssistantSectionAction} place="setup" backHref={backHref}>
      {(state) => {
        const errors = state?.errors?.fieldErrors;
        const typed = state?.errors?.values;
        return (
          <>
            <TextAreaField
              name="instructions"
              label="Anything ansa should know or always do (optional)"
              hint="For example: mention the dish of the day, or that the terrace is closed in winter."
              defaultValue={typed?.instructions ?? instructions}
              maxLength={INSTRUCTIONS_MAX_LENGTH}
              rows={4}
              errors={errors?.instructions}
            />
            <TextAreaField
              name="holdingReply"
              label="When a person needs to take over"
              hint="What ansa sends when it isn't sure, or for a complaint or a refund. It alerts you at the same time, so nobody waits in silence."
              defaultValue={typed?.holdingReply ?? holdingReply}
              maxLength={HOLDING_REPLY_MAX_LENGTH}
              required
              errors={errors?.holdingReply}
            />
          </>
        );
      }}
    </SectionForm>
  );
}
