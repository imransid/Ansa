"use client";

import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  name: string;
  onName: (name: string) => void;
  number: string;
  onNumber: (number: string) => void;
  onCall: () => void;
  waiting: boolean;
};

// Before a practice call: the made-up caller's name and number (each number
// is one caller, with their own conversation), and the button that calls.
export function WhoIsCalling({ name, onName, number, onNumber, onCall, waiting }: Props) {
  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Who is calling?</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="caller-name">Caller&apos;s name</Label>
          <Input id="caller-name" value={name} maxLength={200} onChange={(event) => onName(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="caller-number">Caller&apos;s phone number</Label>
          <Input id="caller-number" value={number} maxLength={40} inputMode="tel" onChange={(event) => onNumber(event.target.value)} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Any made-up name and number: each number is one caller, with their own conversation in your Inbox.</p>
      <Button type="button" onClick={onCall} disabled={waiting} className="justify-self-start">
        <PhoneCall aria-hidden />
        {waiting ? "Calling..." : "Call ansa"}
      </Button>
    </div>
  );
}
