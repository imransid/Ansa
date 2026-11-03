"use client";

import { useState } from "react";
import { Mic, PhoneOff, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  voice: { talking: boolean; live: string; finish: () => void };
  waiting: boolean;
  noBanglaVoice: boolean;
  onTalk: () => void;
  onHangUp: () => void;
  onType: (text: string) => void;
};

// On a practice call: talk (then stop and send), type what the caller says
// instead, or hang up. Hang up works while ansa is thinking too: the page
// then drops its answer.
export function CallControls({ voice, waiting, noBanglaVoice, onTalk, onHangUp, onType }: Props) {
  const [typed, setTyped] = useState("");

  function sendTyped(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = typed.trim();
    if (text === "") {
      return;
    }
    setTyped("");
    onType(text);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {voice.talking ? (
          <Button type="button" onClick={voice.finish}>
            <Square aria-hidden />
            Stop and send
          </Button>
        ) : (
          <Button type="button" onClick={onTalk} disabled={waiting}>
            <Mic aria-hidden />
            Talk
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onHangUp}>
          <PhoneOff aria-hidden />
          Hang up
        </Button>
      </div>
      {voice.talking && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Listening... press &ldquo;Stop and send&rdquo; when you&apos;ve finished.
          {voice.live && <span className="mt-1 block text-foreground">&ldquo;{voice.live}&rdquo;</span>}
        </p>
      )}
      {noBanglaVoice && (
        <p className="text-sm text-muted-foreground">
          This browser has no Bangla voice, so ansa&apos;s Bangla answers are shown here but not spoken. Microsoft Edge (free) has Bangla
          voices: open this page in Edge to hear them.
        </p>
      )}
      <form onSubmit={sendTyped} className="flex gap-2">
        <Label htmlFor="caller-typed" className="sr-only">
          Or type what the caller says
        </Label>
        <Input
          id="caller-typed"
          value={typed}
          maxLength={2000}
          placeholder="Or type what the caller says"
          onChange={(event) => setTyped(event.target.value)}
          disabled={waiting || voice.talking}
        />
        <Button type="submit" variant="outline" disabled={waiting || voice.talking}>
          <Send aria-hidden />
          Send
        </Button>
      </form>
    </div>
  );
}
