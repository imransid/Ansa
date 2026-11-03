"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MessageFormProps = {
  // Where the business (or the person) answers itself on this channel ("the WhatsApp Business app").
  ownApp: string;
  // One person's account: they answer as themselves, to people, not customers.
  personal: boolean;
  asBusiness: boolean;
  onAsBusinessChange: (asBusiness: boolean) => void;
  text: string;
  onTextChange: (text: string) => void;
  error: string;
  isSending: boolean;
  canSend: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

// The words of the box, for a business and for one person.
const WORDS = {
  business: {
    tick: "Answer as the business, from its own app",
    help: (app: string) =>
      `Ticked, you write as the business would in ${app}, not in ansa: the customer gets it, and ansa sees you answered (Settings → Connections says what it does then). The customer writes first.`,
    answerLabel: "The business's answer",
    answerPlaceholder: "Yes, it left a few minutes ago.",
    messagePlaceholder: "Are you open tonight?",
  },
  personal: {
    tick: "Answer as yourself, from your own app",
    help: (app: string) =>
      `Ticked, you write as you would in ${app}, not in ansa: they get it, and ansa sees you answered (Settings → Connections says what it does then). They write first.`,
    answerLabel: "Your answer",
    answerPlaceholder: "Back now, I'll call you in a bit.",
    messagePlaceholder: "Are you free on Friday?",
  },
};

// The box under the practice chat: the customer's next message, or, ticked,
// the business's own answer to them, as if written in its own app instead
// of ansa (core saves it as that channel saves one: ansa sees it, and steps
// back as Settings → Connections says).
export function MessageForm(props: MessageFormProps) {
  const { ownApp, personal, asBusiness, onAsBusinessChange, text, onTextChange, error, isSending, canSend, onSubmit } = props;
  const words = personal ? WORDS.personal : WORDS.business;
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <div className="grid gap-1">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={asBusiness} aria-describedby="as-business-help" className="mt-0.5" onChange={(event) => onAsBusinessChange(event.target.checked)} />
          <span>{words.tick}</span>
        </label>
        <p id="as-business-help" className="text-xs text-muted-foreground">
          {words.help(ownApp)}
        </p>
      </div>
      <Label htmlFor="customer-message">{asBusiness ? words.answerLabel : "Message"}</Label>
      <div className="flex gap-2">
        <Input
          id="customer-message"
          value={text}
          maxLength={4000}
          autoComplete="off"
          placeholder={asBusiness ? words.answerPlaceholder : words.messagePlaceholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "customer-message-error" : undefined}
          onChange={(event) => onTextChange(event.target.value)}
        />
        <Button type="submit" disabled={isSending || !canSend}>
          {isSending ? "Sending..." : asBusiness ? "Answer" : "Send"}
        </Button>
      </div>
      {error && (
        <p id="customer-message-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
