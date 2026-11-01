"use client";

import { saveAutopostAction } from "@/app/actions/autopost";
import { Choice, Choices } from "@/components/restaurant-setup/assistant-settings-form";
import { CheckField } from "@/components/restaurant-setup/check-field";
import { FieldErrors, SectionForm } from "@/components/restaurant-setup/section-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTOPOST_FREQUENCIES, AUTOPOST_FREQUENCY_LABELS, type AutopostFrequency, type AutopostMode } from "@/lib/autopost/schedule";

type AutopostFormProps = { enabled: boolean; frequency: AutopostFrequency; time: string; mode: AutopostMode };

const FREQUENCY_HINTS: Record<AutopostFrequency, string> = {
  daily: "Best for busy places with lots to show.",
  three_a_week: "A good start for most businesses.",
  weekly: "A steady, quiet presence.",
};

// Settings → Posts for me (step 54, owners): on or off, how often, what
// time, and whether each post waits for the owner. Turning on automatic
// posting needs the owner's tick: posts then go out without anyone
// approving each one.
export function AutopostForm(props: AutopostFormProps) {
  return (
    <SectionForm action={saveAutopostAction} place="settings">
      {(state) => {
        const errors = state?.errors?.fieldErrors;
        const typed = state?.errors?.values;
        return (
          <>
            <Choices legend="Post for me" name="enabled" errors={errors?.enabled}>
              <Choice name="enabled" value="on" defaultChecked={props.enabled} label="On">
                ansa writes and posts on your Facebook Page by itself.
              </Choice>
              <Choice name="enabled" value="off" defaultChecked={!props.enabled} label="Off">
                ansa doesn&apos;t post.
              </Choice>
            </Choices>
            <Choices legend="How often" name="frequency" errors={errors?.frequency}>
              {AUTOPOST_FREQUENCIES.map((frequency) => (
                <Choice
                  key={frequency}
                  name="frequency"
                  value={frequency}
                  defaultChecked={(typed?.frequency ?? props.frequency) === frequency}
                  label={AUTOPOST_FREQUENCY_LABELS[frequency]}
                >
                  {FREQUENCY_HINTS[frequency]}
                </Choice>
              ))}
            </Choices>
            <div className="grid gap-2">
              <Label htmlFor="autopost-time">At what time (your time zone)</Label>
              <Input
                id="autopost-time"
                type="time"
                name="time"
                required
                defaultValue={typed?.time ?? props.time}
                className="w-36 px-2.5"
                aria-invalid={errors?.time ? true : undefined}
                aria-describedby={errors?.time ? "time-errors" : undefined}
              />
              <FieldErrors id="time-errors" errors={errors?.time} />
            </div>
            <Choices legend="Each post" name="mode" errors={errors?.mode}>
              <Choice name="mode" value="automatic" defaultChecked={(typed?.mode ?? props.mode) === "automatic"} label="Automatic">
                ansa posts it at the time. You can cancel any post before it goes out.
              </Choice>
              <Choice name="mode" value="ask_first" defaultChecked={(typed?.mode ?? props.mode) === "ask_first"} label="Ask me first">
                ansa writes it a day ahead, and it waits for your approval.
              </Choice>
            </Choices>
            <div className="grid gap-1">
              <CheckField
                name="understood"
                label="Yes, ansa may post on my Page without asking me each time"
                hint="Needed for Automatic. ansa uses only your own details and prices, and never invents an offer."
                defaultChecked={props.enabled && props.mode === "automatic"}
              />
              <FieldErrors id="understood-errors" errors={errors?.understood} />
            </div>
          </>
        );
      }}
    </SectionForm>
  );
}
