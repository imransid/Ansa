"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { editDraftAction } from "@/app/actions/content-studio";
import { PLATFORM_RULES } from "@/lib/content-rules";
import type { EditorValues } from "@/lib/content-studio/editor-values";
import type { ContentFormat } from "@/lib/content-studio/formats";
import {
  DRAFT_BODY_MAX_LENGTH,
  DRAFT_CALL_TO_ACTION_MAX_LENGTH,
  DRAFT_IMAGE_PROMPT_MAX_LENGTH,
  DRAFT_TITLE_MAX_LENGTH,
  DRAFT_TOPIC_MAX_LENGTH,
  DRAFT_VIDEO_SCRIPT_MAX_LENGTH,
} from "@/lib/content-studio/limits";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { PlanChoices } from "@/services/content-drafts";
import { PlanChoiceSelect } from "../plan-choice-select";
import { EditorBox, EditorButtons, EditorLine } from "./editor-fields";

type DraftEditorProps = {
  draftId: string;
  // The version the editor opened with: a save is refused when the draft changed since.
  version: number;
  platform: SocialPlatform;
  format: ContentFormat;
  values: EditorValues;
  onChange: (values: EditorValues) => void;
  onUndo: () => void;
  isDirty: boolean;
  // Archived: shown, not changed.
  readOnly: boolean;
  // A decision or the AI is at work: the boxes wait until it ends.
  isBusy: boolean;
  // What saving a change takes away (draft-workspace.tsx), or null.
  changeWarning: string | null;
  planChoices: PlanChoices;
};

// The draft's editor (step 38), anyone in the company. Its boxes are the
// workspace's state (draft-workspace.tsx), so the counts and the preview
// follow every key, and a refused save keeps everything typed. Only the
// fields the platform and format use are shown.
export function DraftEditor(props: DraftEditorProps) {
  const { values } = props;
  const [state, saveAction, isSaving] = useActionState(editDraftAction, undefined);
  // Nothing typed while a save or a decision runs: the version it brings would replace it.
  const readOnly = props.readOnly || props.isBusy || isSaving;
  // "Saved." is about the save that worked: typing again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const errors = isSaving ? undefined : state?.errors;
  const errorOf = (field: string) => errors?.fieldErrors?.[field]?.[0];

  function change(field: keyof EditorValues) {
    return (value: string) => {
      setChangedSinceSave(true);
      props.onChange({ ...values, [field]: value });
    };
  }

  // WHY by hand: when <form action> runs an action, React resets the form
  // afterwards, and a menu React controls (pillar, campaign) then shows its
  // first option while the editor still holds the one picked; the next Save
  // would send what it shows. An action started here, in a transition, runs
  // without that reset. (`action` stays on the form so a click before the
  // page has loaded sends nothing.)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChangedSinceSave(false);
    const formData = new FormData(event.currentTarget);
    startTransition(() => saveAction(formData));
  }

  return (
    <form action={saveAction} onSubmit={submit} className="grid content-start gap-4">
      <input type="hidden" name="draftId" value={props.draftId} />
      <input type="hidden" name="version" value={props.version} />
      <EditorLine
        readOnly={readOnly}
        id="draft-topic"
        name="topic"
        label="Topic"
        value={values.topic}
        onChange={change("topic")}
        maxLength={DRAFT_TOPIC_MAX_LENGTH}
        error={errorOf("topic")}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <PlanChoiceSelect
          id="draft-pillar"
          name="pillar"
          label="Content pillar"
          choices={props.planChoices.pillars}
          value={values.pillar}
          onChange={change("pillar")}
          disabled={readOnly}
        />
        <PlanChoiceSelect
          id="draft-campaign"
          name="campaign"
          label="Campaign"
          choices={props.planChoices.campaigns}
          value={values.campaign}
          onChange={change("campaign")}
          disabled={readOnly}
        />
      </div>
      {props.platform === "youtube" && (
        <EditorLine
          readOnly={readOnly}
          id="draft-title"
          name="title"
          label="Video title"
          value={values.title}
          onChange={change("title")}
          maxLength={DRAFT_TITLE_MAX_LENGTH}
          error={errorOf("title")}
        />
      )}
      <EditorBox
        readOnly={readOnly}
        id="draft-body"
        name="body"
        label={PLATFORM_RULES[props.platform].text.label}
        rows={props.platform === "x" ? 4 : 10}
        value={values.body}
        onChange={change("body")}
        maxLength={DRAFT_BODY_MAX_LENGTH}
        help="Without the call to action and the hashtags: they are added after it, each as its own paragraph."
        error={errorOf("body")}
      />
      <EditorLine
        readOnly={readOnly}
        id="draft-call-to-action"
        name="callToAction"
        label="Call to action"
        value={values.callToAction}
        onChange={change("callToAction")}
        maxLength={DRAFT_CALL_TO_ACTION_MAX_LENGTH}
        help="One short sentence asking the reader to do one thing, or nothing."
        error={errorOf("callToAction")}
      />
      <EditorLine
        readOnly={readOnly}
        id="draft-hashtags"
        name="hashtags"
        label="Hashtags"
        value={values.hashtags}
        onChange={change("hashtags")}
        maxLength={2_000}
        help="Words separated by spaces, with or without #."
        error={errorOf("hashtags")}
      />
      {props.format !== "post" && (
        <EditorBox
          readOnly={readOnly}
          id="draft-image-prompt"
          name="imagePrompt"
          label={props.format === "video" ? "Thumbnail: what it shows" : "Image: what it shows"}
          rows={3}
          value={values.imagePrompt}
          onChange={change("imagePrompt")}
          maxLength={DRAFT_IMAGE_PROMPT_MAX_LENGTH}
          help="Not published: a description to make or pick the picture from."
          error={errorOf("imagePrompt")}
        />
      )}
      {props.format === "video" && (
        <EditorBox
          readOnly={readOnly}
          id="draft-video-script"
          name="videoScript"
          label="Video script"
          rows={10}
          value={values.videoScript}
          onChange={change("videoScript")}
          maxLength={DRAFT_VIDEO_SCRIPT_MAX_LENGTH}
          help="Not published as text: what is said and shown, scene by scene."
          error={errorOf("videoScript")}
        />
      )}
      <p className="text-xs text-muted-foreground">Stored as plain text and read by the AI: leave out your customers&apos; details.</p>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
      {!props.readOnly && <EditorButtons {...props} isSaving={isSaving} saved={state?.saved === true && !isSaving && !changedSinceSave} />}
    </form>
  );
}
