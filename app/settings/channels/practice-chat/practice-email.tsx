"use client";

import { useState, useTransition, type FormEvent } from "react";
import { sendPracticeEmailAction } from "@/app/actions/practice-chat";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// The limits core checks (core/internal/api/practice_email.go).
const NAME_MAX_LENGTH = 100;
const ADDRESS_MAX_LENGTH = 320;
const SUBJECT_MAX_LENGTH = 1000;
const TEXT_MAX_LENGTH = 100_000;

// The customer's email (development only): it goes to your forwarding
// address as a customer's email forwarded to ansa arrives through Resend,
// and core reads it as any received email. ansa doesn't answer emails: each
// one becomes a request in the Inbox.
// personal: one person's account (emails become notes for them).
export function PracticeEmail({ available, personal }: { available: boolean; personal: boolean }) {
  const [name, setName] = useState("Tanvir Ahmed");
  const [address, setAddress] = useState("tanvir@example.com");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [verified, setVerified] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [isSending, startSending] = useTransition();

  if (!available) {
    return (
      <p className="rounded-2xl border border-dashed px-5 py-4 text-sm">
        Real email is on here (SEND_REAL_EMAIL), so ansa would ask Resend for a practice email instead of reading it. Switch real email off
        to practice.
      </p>
    );
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending) {
      return;
    }
    startSending(async () => {
      const sent = await sendPracticeEmailAction({ name, address, subject, text, verified });
      if (!sent.ok) {
        setFields(sent.fields);
        setError(sent.error);
        setSentTo("");
        return;
      }
      setFields({});
      setError("");
      setSentTo(sent.to);
      setSubject("");
      setText("");
    });
  }

  return (
    <form onSubmit={send} className="grid gap-4 rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">
        {personal
          ? "Your email goes to your forwarding address, like an email forwarded to ansa. ansa doesn't answer emails: each one becomes a note in your Inbox."
          : "Your email goes to your forwarding address, like a customer's email forwarded to ansa. ansa doesn't answer emails: each one becomes a request in your Inbox."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="email-name">Sender&apos;s name</Label>
          <Input
            id="email-name"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            {...errorProps("email-name", fields.name)}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError id="email-name" error={fields.name} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email-address">Sender&apos;s address</Label>
          {/* Not type="email": core alone judges the address, by the
              customer address rule (browsers differ on international ones). */}
          <Input
            id="email-address"
            inputMode="email"
            spellCheck={false}
            value={address}
            maxLength={ADDRESS_MAX_LENGTH}
            autoComplete="off"
            {...errorProps("email-address", fields.address)}
            onChange={(event) => setAddress(event.target.value)}
          />
          <FieldError id="email-address" error={fields.address} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="email-subject">Subject</Label>
        <Input
          id="email-subject"
          value={subject}
          maxLength={SUBJECT_MAX_LENGTH}
          autoComplete="off"
          placeholder="A table for six on Friday?"
          {...errorProps("email-subject", fields.subject)}
          onChange={(event) => setSubject(event.target.value)}
        />
        <FieldError id="email-subject" error={fields.subject} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="email-text">Text</Label>
        <Textarea
          id="email-text"
          rows={6}
          value={text}
          maxLength={TEXT_MAX_LENGTH}
          placeholder="Hello, do you have a table for six on Friday at 8 pm?"
          {...errorProps("email-text", fields.text)}
          onChange={(event) => setText(event.target.value)}
        />
        <FieldError id="email-text" error={fields.text} />
      </div>
      <div className="grid gap-1">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={verified} aria-describedby="email-verified-help" className="mt-0.5" onChange={(event) => setVerified(event.target.checked)} />
          <span>Sender verified (as Resend reports DKIM/DMARC passed)</span>
        </label>
        <p id="email-verified-help" className="text-xs text-muted-foreground">
          {personal
            ? "Ticked, as for a real sender Resend verified, the address is saved as theirs. Not ticked, it is only suggested for you to confirm, as for an email anyone could have forged."
            : "Ticked, as for a real sender Resend verified, the address becomes the request's customer email. Not ticked, it is only suggested for a person to confirm, as for an email anyone could have forged."}
        </p>
      </div>
      <div>
        <Button type="submit" disabled={isSending}>
          {isSending ? "Sending..." : "Send the email"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {sentTo && (
        <p role="status" className="text-sm wrap-anywhere">
          Sent to {sentTo}. It arrives in your{" "}
          <a href="/inbox" target="_blank" rel="noreferrer" className="text-link hover:underline">
            Inbox
          </a>{" "}
          in a few seconds, as a request. The{" "}
          <a href="/emails" target="_blank" rel="noreferrer" className="text-link hover:underline">
            Emails page
          </a>{" "}
          shows what became of each email (both open in a new tab).
        </p>
      )}
    </form>
  );
}

// A refused field says so and names its error, so a screen reader reads it again on focus.
function errorProps(id: string, error: string | undefined) {
  return error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
}

// The field's error, announced as it appears.
function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) {
    return null;
  }
  return (
    <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}
