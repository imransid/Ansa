"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { Mic, PhoneOff, Send, Square } from "lucide-react";
import { endPracticeCallAction, practiceCallTurnAction, startPracticeCallAction } from "@/app/actions/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserCanHear, speak, type CallLanguage, type Hearing } from "@/lib/practice-phone/speech";
import { CallLog, type Line } from "./call-log";
import { CallSettings } from "./call-settings";
import { useCallerVoice, type Said } from "./use-caller-voice";
import { WhoIsCalling } from "./who-is-calling";

type Call = { id: string; conversationId: string };

// Whether the browser can hear is known only in the browser (false while
// the server renders the page).
const subscribeToNothing = () => () => {};

// The practice phone (step 55): pretend to be a caller, talk (or type) in
// English or Bangla, and hear ansa answer with the browser's voice. The
// buttons call the actions inside a transition, so nothing typed is lost to
// a form reset.
export function PracticePhone() {
  const [callerName, setCallerName] = useState("Lena");
  const [callerNumber, setCallerNumber] = useState("+39 333 123 4567");
  const [call, setCall] = useState<Call | null>(null);
  const [endedCall, setEndedCall] = useState<Call | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<CallLanguage>("en");
  const [chosenHearing, setHearing] = useState<Hearing | null>(null);
  const [noBanglaVoice, setNoBanglaVoice] = useState(false);
  const [isWaiting, startWaiting] = useTransition();
  const canBrowserHear = useSyncExternalStore(subscribeToNothing, browserCanHear, () => false);
  // The browser hears the caller when it can, unless Whisper was chosen.
  const hearing: Hearing = canBrowserHear && chosenHearing !== "whisper" ? "browser" : "whisper";
  const voice = useCallerVoice(language, hearing, send, setError);

  function hear(words: string[]) {
    setLines((before) => [...before, ...words.map((text) => ({ who: "ansa" as const, text }))]);
    void speak(words).then((result) => {
      if (result === "no-voice") {
        setNoBanglaVoice(true);
      }
    });
  }

  function pickUp() {
    setError("");
    startWaiting(async () => {
      const started = await startPracticeCallAction({ callerName, callerNumber });
      if (!started.ok) {
        setError(started.error);
        return;
      }
      setEndedCall(null);
      setLines([]);
      setCall({ id: started.callId, conversationId: started.conversationId });
      hear(started.words);
    });
  }

  function send(said: Said, shown: string | null) {
    if (!call) {
      return;
    }
    setError("");
    startWaiting(async () => {
      const answer = await practiceCallTurnAction({ callId: call.id, ...said });
      if (!answer.ok) {
        setError(answer.error);
        if (answer.over) {
          setCall(null);
        }
        return;
      }
      const heard = shown ?? answer.heard;
      setLines((before) => [...before, { who: "caller", text: heard || "(nothing heard)" }]);
      hear(answer.words);
    });
  }

  function startTalking() {
    setError("");
    void voice.start();
  }

  function sendTyped(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = typed.trim();
    if (text === "") {
      return;
    }
    setTyped("");
    send({ text }, text);
  }

  function hangUp() {
    if (!call) {
      return;
    }
    const ending = call;
    voice.cancel();
    window.speechSynthesis?.cancel();
    setCall(null);
    startWaiting(async () => {
      await endPracticeCallAction({ callId: ending.id });
      setEndedCall(ending);
    });
  }

  return (
    <div className="grid gap-5">
      <CallSettings language={language} onLanguage={setLanguage} hearing={hearing} onHearing={setHearing} canBrowserHear={canBrowserHear} />

      {!call && <WhoIsCalling name={callerName} onName={setCallerName} number={callerNumber} onNumber={setCallerNumber} onCall={pickUp} waiting={isWaiting} />}

      {(call || lines.length > 0) && (
        <section aria-labelledby="call-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
          <h2 id="call-heading" className="text-lg font-semibold">
            {call ? "On the call" : "The call"}
          </h2>
          <CallLog lines={lines} callerName={callerName} thinking={isWaiting && call !== null} />
          {call && (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {voice.talking ? (
                  <Button type="button" onClick={voice.finish}>
                    <Square aria-hidden />
                    Stop and send
                  </Button>
                ) : (
                  <Button type="button" onClick={startTalking} disabled={isWaiting}>
                    <Mic aria-hidden />
                    Talk
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={hangUp}>
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
                  disabled={isWaiting || voice.talking}
                />
                <Button type="submit" variant="outline" disabled={isWaiting || voice.talking}>
                  <Send aria-hidden />
                  Send
                </Button>
              </form>
            </div>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {endedCall && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Call ended.{" "}
          <Link href={`/inbox/${endedCall.conversationId}`} className="text-link hover:underline">
            See it in your Inbox
          </Link>
          : what they said, what ansa answered, and any request or order it made.
        </p>
      )}
    </div>
  );
}
