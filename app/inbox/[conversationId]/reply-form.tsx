"use client";

import { useActionState } from "react";
import { replyAction } from "@/app/actions/conversations";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REPLY_MAX_LENGTH } from "@/lib/conversations";

// A person's reply to a chat customer (step 47). Sending it takes the
// conversation over from ansa. After a refused send the text stays.
// `draft`: the assistant's waiting reply being edited (step 49): the box
// starts with its text, and sending this replaces it.
export function ReplyForm({
  conversationId,
  handledByAssistant,
  draft,
}: {
  conversationId: string;
  handledByAssistant: boolean;
  draft?: { id: string; text: string };
}) {
  const [state, action, isSending] = useActionState(replyAction, undefined);
  const errors = state?.errors?.fieldErrors?.text;
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      {draft && <input type="hidden" name="replacesDraftId" value={draft.id} />}
      <Label htmlFor="reply-text">Your reply</Label>
      <Textarea
        id="reply-text"
        name="text"
        rows={3}
        required
        maxLength={REPLY_MAX_LENGTH}
        defaultValue={state?.errors?.values?.text ?? draft?.text}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? "reply-hint reply-errors" : "reply-hint"}
      />
      <p id="reply-hint" className="text-xs text-muted-foreground">
        {draft
          ? "Your edited reply replaces ansa's, and takes this conversation over from ansa."
          : handledByAssistant
            ? "Sending a reply takes this conversation over from ansa."
            : "You are handling this conversation."}
      </p>
      {errors && (
        <p id="reply-errors" role="alert" className="text-sm text-destructive">
          {errors[0]}
        </p>
      )}
      {state?.errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
      <Button type="submit" disabled={isSending} className="justify-self-start">
        {isSending ? "Sending..." : "Send reply"}
      </Button>
    </form>
  );
}
