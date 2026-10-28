"use client";

import { useActionState } from "react";
import { generateMediaAction } from "@/app/actions/media";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/media/limits";

type GenerateMediaFormProps = {
  // The service in use makes videos too (the development stand-in doesn't).
  makesVideo: boolean;
  isStandIn: boolean;
};

// "Generate an image" on the media page (step 39), anyone in the company.
// The request is saved, and the image is made right after the answer: the
// list of requests above the library shows it waiting, then done, and the
// page refreshes by itself. A refused request keeps what was typed and picked.
export function GenerateMediaForm({ makesVideo, isStandIn }: GenerateMediaFormProps) {
  const [errors, action, isAsking] = useActionState(generateMediaAction, undefined);
  // The messages are about the last request: hidden while a new one runs.
  const shown = isAsking ? undefined : errors;
  // React reads a menu's default only when it first renders: the key
  // renders it again with what was picked (ui-polish-checks.ts says why).
  const kind = errors?.values?.kind === "video" ? "video" : "image";
  const promptError = shown?.fieldErrors?.prompt?.[0];
  const kindError = shown?.fieldErrors?.kind?.[0];

  return (
    <form action={action} className="grid max-w-2xl gap-3">
      <div className="grid gap-2">
        <Label htmlFor="generate-kind">Make</Label>
        <NativeSelect id="generate-kind" name="kind" key={kind} defaultValue={kind} className="w-48" aria-invalid={kindError ? true : undefined}>
          <option value="image">An image</option>
          <option value="video">A video</option>
        </NativeSelect>
        {!makesVideo && (
          <p className="text-xs text-muted-foreground">
            {isStandIn
              ? "The development stand-in makes images only: a video request fails, and says so."
              : "The image service in use makes images only: a video request fails, and says so."}
          </p>
        )}
        {kindError && (
          <p role="alert" className="text-sm text-destructive">
            {kindError}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="generate-prompt">What it should show</Label>
        <Textarea
          id="generate-prompt"
          name="prompt"
          rows={4}
          required
          maxLength={GENERATION_PROMPT_MAX_LENGTH}
          defaultValue={errors?.values?.prompt ?? ""}
          aria-invalid={promptError ? true : undefined}
          aria-describedby={promptError ? "generate-prompt-help generate-prompt-error" : "generate-prompt-help"}
        />
        <p id="generate-prompt-help" className="text-xs text-muted-foreground">
          Plain words, like &ldquo;Fresh sourdough loaves on a wooden counter, morning light&rdquo;. It is sent to the image
          service: leave out your customers&apos; details, and real people&apos;s names or faces.
        </p>
        {promptError && (
          <p id="generate-prompt-error" role="alert" className="text-sm text-destructive">
            {promptError}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isAsking}>
          {isAsking ? "Asking..." : "Make it"}
        </Button>
        {shown?.message && (
          <p role="alert" className="text-sm text-destructive">
            {shown.message}
          </p>
        )}
      </div>
    </form>
  );
}
