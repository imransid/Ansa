"use client";

import { useState, useTransition, type FormEvent } from "react";
import { newestDevMailAction } from "@/app/actions/dev-mailbox";
import { DevMailText } from "@/components/dev-mail-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DevMail } from "@/lib/core-views/dev-mailbox";

// Development only (for trying and showing ansa on the laptop): the email
// ansa just "sent" (a confirmation or reset link) isn't sent anywhere; this
// shows the newest one to the address typed, with its link. Hidden in a
// production build, where real email goes to real inboxes (and core refuses).
export function DevMailPeek() {
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState<DevMail | null | undefined>(undefined);
  const [isLooking, startLooking] = useTransition();
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  function look(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startLooking(async () => setEmail(await newestDevMailAction({ email: address })));
  }

  return (
    <div className="grid w-full max-w-sm gap-3 rounded-xl border border-dashed p-4 text-sm">
      <p className="font-medium">Development: open the email here</p>
      <p className="text-muted-foreground">On this computer nothing is really sent. Type the address to see the newest email ansa wrote to it.</p>
      <form onSubmit={look} className="grid gap-2">
        <Label htmlFor="dev-mail-address">Email address</Label>
        <div className="flex gap-2">
          <Input id="dev-mail-address" type="email" value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="email" />
          <Button type="submit" variant="outline" disabled={isLooking || !address.trim()}>
            {isLooking ? "Looking..." : "Show"}
          </Button>
        </div>
      </form>
      {email === null && <p role="status">No email to that address yet.</p>}
      {email && (
        <div role="status" className="grid gap-1 rounded-lg bg-muted p-3">
          <p className="font-medium">{email.subject}</p>
          <DevMailText text={email.text} />
        </div>
      )}
    </div>
  );
}
