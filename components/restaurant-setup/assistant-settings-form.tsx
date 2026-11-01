"use client";

import type { ReactNode } from "react";
import { saveAssistantSettingsAction } from "@/app/actions/restaurant-setup";
import { HOLDING_REPLY_MAX_LENGTH, INSTRUCTIONS_MAX_LENGTH, type AssistantStatus, type ReplyMode } from "@/lib/restaurant-setup";
import { CheckField } from "./check-field";
import { SectionForm } from "./section-form";
import { TextAreaField } from "./text-area-field";

type AssistantSettingsFormProps = {
  status: AssistantStatus;
  replyMode: ReplyMode;
  instructions: string;
  holdingReply: string;
  alertByEmail: boolean;
};

// Settings → Assistant (owners): whether it answers, how, what it says when a
// person takes over, and the email alerts.
export function AssistantSettingsForm(props: AssistantSettingsFormProps) {
  return (
    <SectionForm action={saveAssistantSettingsAction} place="settings">
      {(state) => {
        const errors = state?.errors?.fieldErrors;
        const typed = state?.errors?.values;
        return (
          <>
            <Choices legend="Replies" name="replyMode" errors={errors?.replyMode}>
              <Choice name="replyMode" value="automatic" defaultChecked={props.replyMode === "automatic"} label="Automatic">
                ansa answers on its own. When it isn&apos;t sure, or something needs you, it says so and tells you.
              </Choice>
              <Choice name="replyMode" value="ask_first" defaultChecked={props.replyMode === "ask_first"} label="Ask me first">
                ansa writes each reply and waits for you to send it.
              </Choice>
            </Choices>
            <TextAreaField
              name="instructions"
              label="Anything ansa should know or always do (optional)"
              hint="For example: “Answer in Italian when people write in Italian.” or “Never give out my phone number.”"
              defaultValue={typed?.instructions ?? props.instructions}
              maxLength={INSTRUCTIONS_MAX_LENGTH}
              rows={4}
              errors={errors?.instructions}
            />
            <TextAreaField
              name="holdingReply"
              label="What ansa says when you need to answer yourself"
              hint="Sent when ansa isn't sure, or something needs you."
              defaultValue={typed?.holdingReply ?? props.holdingReply}
              maxLength={HOLDING_REPLY_MAX_LENGTH}
              required
              errors={errors?.holdingReply}
            />
            <CheckField
              name="alertByEmail"
              label="Email me when something needs me"
              hint="As well as a note in Telegram, when it's connected."
              defaultChecked={props.alertByEmail}
            />
            <Choices legend="On or paused" name="status" errors={errors?.status}>
              <Choice name="status" value="on" defaultChecked={props.status === "on"} label="On">
                ansa answers as set here.
              </Choice>
              <Choice name="status" value="paused" defaultChecked={props.status === "paused"} label="Paused">
                ansa answers nobody until you turn it back on.
              </Choice>
            </Choices>
          </>
        );
      }}
    </SectionForm>
  );
}

export function Choices({ legend, name, errors, children }: { legend: string; name: string; errors?: string[]; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3" aria-describedby={errors ? `${name}-errors` : undefined}>
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      {children}
      {errors && (
        <p id={`${name}-errors`} role="alert" className="text-sm text-destructive">
          {errors[0]}
        </p>
      )}
    </fieldset>
  );
}

// One option of a choice, as a radio button with what it means.
export function Choice({ name, value, label, defaultChecked, children }: { name: string; value: string; label: string; defaultChecked: boolean; children: ReactNode }) {
  const id = `${name}-${value}`;
  return (
    <div className="flex items-start gap-3">
      <input type="radio" id={id} name={name} value={value} defaultChecked={defaultChecked} required aria-describedby={`${id}-hint`} className="mt-1 size-4 accent-primary" />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}
