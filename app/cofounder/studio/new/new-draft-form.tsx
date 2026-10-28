"use client";

import { startTransition, useActionState, useState, type SubmitEvent } from "react";
import { createDraftAction } from "@/app/actions/content-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { describeAcceptedFormats, PLATFORM_RULES } from "@/lib/content-rules";
import { CONTENT_FORMAT_LABELS, type ContentFormat } from "@/lib/content-studio/formats";
import { DRAFT_TOPIC_MAX_LENGTH } from "@/lib/content-studio/limits";
import { SOCIAL_PLATFORM_LABELS, socialPlatforms, type SocialPlatform } from "@/lib/social-platforms";
import type { PlanChoices } from "@/services/content-drafts";
import { PlanChoiceSelect } from "../plan-choice-select";

type NewDraftFormProps = {
  planChoices: PlanChoices;
  // The key facts are confirmed: the AI may write.
  aiCanWrite: boolean;
};

// "New draft" (step 38): the platform, a format it takes, the topic, and the
// plan's pillar and campaign; then "Write it with the AI" or "Start blank"
// (the button pressed sends mode). Every field is kept in state, so the
// help text and the formats offered follow the platform picked, and a
// refusal keeps everything picked and typed. On success the new draft opens.
export function NewDraftForm({ planChoices, aiCanWrite }: NewDraftFormProps) {
  const [platform, setPlatform] = useState<SocialPlatform>("linkedin");
  const [format, setFormat] = useState<ContentFormat>("post");
  const [topic, setTopic] = useState("");
  const [pillar, setPillar] = useState("");
  const [campaign, setCampaign] = useState("");
  // Which button was pressed, for its label while it runs.
  const [mode, setMode] = useState<"generate" | "blank">("generate");
  const [errors, formAction, isPending] = useActionState(createDraftAction, undefined);
  const shownErrors = isPending ? undefined : errors;
  const topicError = shownErrors?.fieldErrors?.topic?.[0];
  const formatError = shownErrors?.fieldErrors?.format?.[0] ?? shownErrors?.fieldErrors?.platform?.[0];

  // A platform that doesn't take the format picked (YouTube: videos only) gets its first one.
  function pickPlatform(next: SocialPlatform) {
    setPlatform(next);
    if (!PLATFORM_RULES[next].formats.includes(format)) {
      setFormat(PLATFORM_RULES[next].formats[0]);
    }
  }

  // WHY by hand: when <form action> runs an action, React resets the form
  // afterwards, and the menus, which React controls, then show their first
  // option (LinkedIn, Text post, None) while the state keeps what was
  // picked; pressing the same button again would send what they show. An
  // action started here, in a transition, runs without that reset. The
  // FormData names the button pressed (mode). (`action` stays on the form
  // so a click before the page has loaded sends nothing.)
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget, event.submitter);
    setMode(formData.get("mode") === "blank" ? "blank" : "generate");
    startTransition(() => formAction(formData));
  }

  return (
    <form action={formAction} onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor="draft-platform">Platform</Label>
          <NativeSelect id="draft-platform" name="platform" value={platform} onChange={(event) => pickPlatform(event.target.value as SocialPlatform)}>
            {socialPlatforms.map((option) => (
              <option key={option} value={option}>
                {SOCIAL_PLATFORM_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="draft-format">Format</Label>
          <NativeSelect
            id="draft-format"
            name="format"
            value={format}
            onChange={(event) => setFormat(event.target.value as ContentFormat)}
            aria-describedby="draft-format-help"
            aria-invalid={formatError ? true : undefined}
          >
            {PLATFORM_RULES[platform].formats.map((option) => (
              <option key={option} value={option}>
                {CONTENT_FORMAT_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
          <p id="draft-format-help" className="text-xs text-muted-foreground">
            {SOCIAL_PLATFORM_LABELS[platform]} takes {describeAcceptedFormats(platform)}.
          </p>
          {formatError && (
            <p role="alert" className="text-sm text-destructive">
              {formatError}
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="draft-topic">Topic</Label>
        <Input
          id="draft-topic"
          name="topic"
          required
          autoComplete="off"
          maxLength={DRAFT_TOPIC_MAX_LENGTH}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          aria-describedby={topicError ? "draft-topic-help draft-topic-error" : "draft-topic-help"}
          aria-invalid={topicError ? true : undefined}
        />
        <p id="draft-topic-help" className="text-xs text-muted-foreground">
          What the post is about, for example &ldquo;our new weekday lunch menu&rdquo;. Stored as plain text and read by
          the AI: leave out your customers&apos; details.
        </p>
        {topicError && (
          <p id="draft-topic-error" role="alert" className="text-sm text-destructive">
            {topicError}
          </p>
        )}
      </div>
      {planChoices.planVersion === null ? (
        <p className="text-sm text-muted-foreground">
          No marketing plan yet: once there is one on the Strategy page, a draft can follow one of its content pillars
          and campaigns.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <PlanChoiceSelect
            id="draft-pillar"
            name="pillar"
            label="Content pillar (optional)"
            choices={planChoices.pillars}
            value={pillar}
            onChange={setPillar}
          />
          <PlanChoiceSelect
            id="draft-campaign"
            name="campaign"
            label="Campaign (optional)"
            choices={planChoices.campaigns}
            value={campaign}
            onChange={setCampaign}
          />
        </div>
      )}
      {shownErrors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {shownErrors.message}
        </p>
      )}
      {/* Always in the page, so screen readers announce what is put in it. */}
      <div role="status" className="text-sm text-muted-foreground">
        {isPending && mode === "generate" && "The AI is writing the draft. This can take a minute or two."}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="mode" value="generate" disabled={isPending || !aiCanWrite}>
          {isPending && mode === "generate" ? "The AI is writing..." : "Write it with the AI"}
        </Button>
        <Button type="submit" name="mode" value="blank" variant="outline" disabled={isPending}>
          {isPending && mode === "blank" ? "Starting..." : "Start blank"}
        </Button>
      </div>
    </form>
  );
}
