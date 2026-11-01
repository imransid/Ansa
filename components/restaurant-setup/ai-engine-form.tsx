"use client";

import { saveAiEngineAction } from "@/app/actions/assistant";
import { Input } from "@/components/ui/input";
import { AI_ENGINE_LABELS, type AiEngine } from "@/lib/assistant/engine";
import { Choice, Choices } from "./assistant-settings-form";
import { CheckField } from "./check-field";
import { FieldErrors, SectionForm } from "./section-form";

type AiEngineFormProps = {
  engine: AiEngine;
  keySource: "restaurant" | "ansa" | "none";
  keyHint: string | null;
  claudeCodeAllowed: boolean;
};

// Settings → Assistant → AI engine (step 49, owners): the Claude API with
// the restaurant's own key (or ansa's), or Claude Code on this computer
// (development only). The key field is never filled in: a saved key shows
// only as its last four characters.
export function AiEngineForm(props: AiEngineFormProps) {
  return (
    <SectionForm action={saveAiEngineAction} place="settings">
      {(state) => {
        const errors = state?.errors?.fieldErrors;
        return (
          <>
            <Choices legend="Which AI answers your customers" name="engine" errors={errors?.engine}>
              <Choice name="engine" value="api_key" defaultChecked={props.engine === "api_key"} label={AI_ENGINE_LABELS.api_key}>
                {describeKey(props)}
              </Choice>
              {props.claudeCodeAllowed && (
                <Choice name="engine" value="claude_code" defaultChecked={props.engine === "claude_code"} label={AI_ENGINE_LABELS.claude_code}>
                  Uses the Claude Code login on the computer running ansa, to try the assistant without an API key. Never for real
                  customers: Anthropic doesn&apos;t allow a product to run on a Claude subscription, so ansa never uses it once live.
                </Choice>
              )}
            </Choices>
            <div className="grid gap-1.5">
              <label htmlFor="apiKey" className="text-sm font-semibold">
                Your Claude API key (optional)
              </label>
              <Input
                id="apiKey"
                name="apiKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={props.keyHint ? `Saved: ends in ${props.keyHint}. Type a new one to replace it.` : "sk-ant-..."}
                aria-invalid={errors?.apiKey ? true : undefined}
                aria-describedby={errors?.apiKey ? "apiKey-hint apiKey-errors" : "apiKey-hint"}
              />
              <p id="apiKey-hint" className="text-xs text-muted-foreground">
                From the Claude Console (platform.claude.com). Stored encrypted; ansa never shows it again.
              </p>
              <FieldErrors id="apiKey-errors" errors={errors?.apiKey} />
            </div>
            {props.keyHint && <CheckField name="removeKey" label="Remove my saved key" hint="ansa's own key is used then, if it has one." defaultChecked={false} />}
          </>
        );
      }}
    </SectionForm>
  );
}

function describeKey({ keySource, keyHint }: AiEngineFormProps): string {
  if (keySource === "restaurant") {
    return `Uses your key (ends in ${keyHint}). You pay Anthropic for what the assistant uses.`;
  }
  if (keySource === "ansa") {
    return "Uses ansa's key until you add your own.";
  }
  return "No key yet: until you add one, every customer gets your holding reply and you are alerted.";
}
