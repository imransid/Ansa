"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { practiceCallTurnAction, startPracticeCallAction } from "@/app/actions/phone";
import { madeUpCallerNumber } from "@/lib/practice-phone/caller";
import { hangUpPracticeCall } from "@/lib/practice-phone/hang-up";
import { browserCanHear, speak, type CallLanguage, type Hearing } from "@/lib/practice-phone/speech";
import { CallControls } from "./call-controls";
import { CallLog, type Line } from "./call-log";
import { CallSettings } from "./call-settings";
import { useCallerVoice, type Said } from "./use-caller-voice";
import { useLiveCall, type Call } from "./use-live-call";
import { WhoIsCalling } from "./who-is-calling";

// Whether the browser can hear is known only in the browser (false while
// the server renders the page).
const subscribeToNothing = () => () => {};

// When the server can't be reached (a dropped connection on a very busy
// laptop): said on the page instead of an error screen.
const COULD_NOT_REACH = "ansa couldn't be reached just now. Try again in a moment.";

// The practice phone (step 55): pretend to be a caller, talk (or type) in
// English or Bangla, and hear ansa answer with the browser's voice. Picking
// up and each turn call their actions inside a transition of their own, so
// nothing typed is lost to a form reset; hanging up shows at once and goes
// through its own route (hangUpPracticeCall), never behind a turn. The
// first caller's number is made up by the server for this visit (made up in
// the browser, it would differ from the page the server rendered).
export function PracticePhone({ firstNumber }: { firstNumber: string }) {
  const [callerName, setCallerName] = useState("Lena");
  const [callerNumber, setCallerNumber] = useState(firstNumber);
  const [call, setCall] = useState<Call | null>(null);
  const [endedCall, setEndedCall] = useState<Call | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<CallLanguage>("en");
  const [chosenHearing, setHearing] = useState<Hearing | null>(null);
  const [noBanglaVoice, setNoBanglaVoice] = useState(false);
  const [isCalling, startCalling] = useTransition();
  const [isThinking, startThinking] = useTransition();
  const liveCall = useLiveCall((ended) => {
    setCall(null);
    setEndedCall(ended);
  });
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
    startCalling(async () => {
      const started = await startPracticeCallAction({ callerName, callerNumber }).catch(() => null);
      if (!started) {
        setError(COULD_NOT_REACH);
        return;
      }
      if (!started.ok) {
        setError(started.error);
        return;
      }
      const picked = { id: started.callId, conversationId: started.conversationId };
      if (!liveCall.begin(picked)) {
        return;
      }
      setEndedCall(null);
      setLines([]);
      setCall(picked);
      hear(started.words);
    });
  }

  function send(said: Said, shown: string | null) {
    const calling = liveCall.current();
    if (!calling) {
      return;
    }
    setError("");
    // Words already known (typed, or heard by the browser) show at once:
    // ansa may think for a while, and the caller's words shouldn't vanish.
    if (shown !== null) {
      setLines((before) => [...before, { who: "caller", text: shown }]);
    }
    startThinking(async () => {
      const answer = await practiceCallTurnAction({ callId: calling.id, ...said }).catch(() => null);
      if (liveCall.current()?.id !== calling.id) {
        // Hung up while ansa was thinking: its answer is never heard.
        return;
      }
      if (!answer) {
        // The caller can say it again: the call is still on.
        setError(COULD_NOT_REACH);
        return;
      }
      if (!answer.ok) {
        setError(answer.error);
        if (answer.over) {
          liveCall.end();
          setCall(null);
        }
        return;
      }
      if (shown === null) {
        // A recording: what Whisper heard is known only now.
        setLines((before) => [...before, { who: "caller", text: answer.heard || "(nothing heard)" }]);
      }
      hear(answer.words);
    });
  }

  function startTalking() {
    setError("");
    void voice.start();
  }

  function hangUp() {
    const ending = liveCall.end();
    if (!ending) {
      return;
    }
    voice.cancel();
    window.speechSynthesis?.cancel();
    setCall(null);
    setEndedCall(ending);
    // Not told (the server couldn't be reached), ansa ends this call when
    // the same caller calls again, as hanging up does.
    void hangUpPracticeCall(ending.id);
  }

  // Someone else calls: a new made-up number (their own conversation) and no name yet.
  function newCaller() {
    setCallerNumber(madeUpCallerNumber());
    setCallerName("");
  }

  return (
    <div className="grid gap-5">
      <CallSettings language={language} onLanguage={setLanguage} hearing={hearing} onHearing={setHearing} canBrowserHear={canBrowserHear} />

      {!call && (
        <WhoIsCalling
          name={callerName}
          onName={setCallerName}
          number={callerNumber}
          onNumber={setCallerNumber}
          onNewCaller={newCaller}
          onCall={pickUp}
          waiting={isCalling}
        />
      )}

      {(call || lines.length > 0) && (
        <section aria-labelledby="call-heading" className="grid gap-4 rounded-2xl border bg-card p-5">
          <h2 id="call-heading" className="text-lg font-semibold">
            {call ? "On the call" : "The call"}
          </h2>
          <CallLog lines={lines} callerName={callerName} thinking={isThinking && call !== null} />
          {call && (
            <CallControls
              voice={voice}
              waiting={isThinking}
              noBanglaVoice={noBanglaVoice}
              onTalk={startTalking}
              onHangUp={hangUp}
              onType={(text) => send({ text }, text)}
            />
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
