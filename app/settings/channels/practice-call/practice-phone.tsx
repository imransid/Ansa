"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Mic, PhoneCall, PhoneOff, Send, Square } from "lucide-react";
import { endPracticeCallAction, practiceCallTurnAction, startPracticeCallAction } from "@/app/actions/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LONGEST_TURN_SECONDS, speak, startRecording, type Recorder } from "@/lib/practice-phone/recording";

type Line = { who: "ansa" | "caller"; text: string };
type Call = { id: string; conversationId: string };

// The practice phone (step 55): pretend to be a caller, talk (or type), and
// hear ansa answer with this computer's voice. The buttons call the actions
// inside a transition, so nothing typed is lost to a form reset.
export function PracticePhone() {
  const [callerName, setCallerName] = useState("Lena");
  const [callerNumber, setCallerNumber] = useState("+39 333 123 4567");
  const [call, setCall] = useState<Call | null>(null);
  const [endedCall, setEndedCall] = useState<Call | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [isWaiting, startWaiting] = useTransition();
  const recorder = useRef<Recorder | null>(null);

  // A turn that runs too long stops by itself.
  useEffect(() => {
    if (!recording) {
      return;
    }
    const timer = window.setInterval(() => {
      if (recorder.current && recorder.current.seconds() >= LONGEST_TURN_SECONDS) {
        finishTalking();
      }
    }, 500);
    return () => window.clearInterval(timer);
  });

  function hear(words: string[]) {
    setLines((before) => [...before, ...words.map((text) => ({ who: "ansa" as const, text }))]);
    void speak(words);
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

  function send(said: { text: string } | { audio: string }, shown: string | null) {
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

  async function startTalking() {
    setError("");
    window.speechSynthesis?.cancel();
    try {
      recorder.current = await startRecording();
      setRecording(true);
    } catch {
      setError("The microphone couldn't be used. Allow it for this page in your browser, or type instead.");
    }
  }

  function finishTalking() {
    const current = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (current) {
      send({ audio: current.stop() }, null);
    }
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
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
    window.speechSynthesis?.cancel();
    setCall(null);
    startWaiting(async () => {
      await endPracticeCallAction({ callId: ending.id });
      setEndedCall(ending);
    });
  }

  return (
    <div className="grid gap-5">
      {!call && (
        <div className="grid gap-3 rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">Who is calling?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="caller-name">Caller&apos;s name</Label>
              <Input id="caller-name" value={callerName} maxLength={200} onChange={(event) => setCallerName(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="caller-number">Caller&apos;s phone number</Label>
              <Input id="caller-number" value={callerNumber} maxLength={40} inputMode="tel" onChange={(event) => setCallerNumber(event.target.value)} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Any made-up name and number: each number is one caller, with their own conversation in your Inbox.
          </p>
          <Button type="button" onClick={pickUp} disabled={isWaiting} className="justify-self-start">
            <PhoneCall aria-hidden />
            {isWaiting ? "Calling..." : "Call ansa"}
          </Button>
        </div>
      )}

      {(call || lines.length > 0) && (
        <section aria-labelledby="call-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
          <h2 id="call-heading" className="text-lg font-semibold">
            {call ? "On the call" : "The call"}
          </h2>
          <ol role="log" aria-live="polite" className="grid gap-2 text-sm">
            {lines.map((line, index) => (
              <li key={index} className={line.who === "ansa" ? "rounded-2xl bg-secondary p-3" : "justify-self-end rounded-2xl border p-3"}>
                <span className="block text-xs text-muted-foreground">{line.who === "ansa" ? "ansa" : callerName || "Caller"}</span>
                {line.text}
              </li>
            ))}
            {isWaiting && call && <li className="text-muted-foreground">ansa is thinking...</li>}
          </ol>
          {call && (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {recording ? (
                  <Button type="button" onClick={finishTalking}>
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
              {recording && <p className="text-sm text-muted-foreground">Listening... press &ldquo;Stop and send&rdquo; when you&apos;ve finished.</p>}
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
                  disabled={isWaiting || recording}
                />
                <Button type="submit" variant="outline" disabled={isWaiting || recording}>
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
