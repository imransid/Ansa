"use client";

import { useEffect, useRef, useState } from "react";
import { LONGEST_TURN_SECONDS, microphoneProblem, startRecording, type Recorder } from "@/lib/practice-phone/recording";
import { startListening, type CallLanguage, type Hearing, type Listener } from "@/lib/practice-phone/speech";

// What the caller said, ready to send: words the browser heard, or a
// recording for Whisper with the language spoken.
export type Said = { text: string } | { audio: string; language: CallLanguage };

// The server action takes at most this many characters of words.
const MOST_WORDS = 2_000;

// The caller's voice on the practice phone: start() listens (the browser's
// recognition, or a recording for Whisper on this computer), finish() hands
// what was said to onSaid, cancel() drops it. A turn longer than a minute
// stops by itself.
export function useCallerVoice(
  language: CallLanguage,
  hearing: Hearing,
  onSaid: (said: Said, shown: string | null) => void,
  onProblem: (message: string) => void,
) {
  const [talking, setTalking] = useState(false);
  // What the browser heard so far, shown while the caller talks.
  const [live, setLive] = useState("");
  const recorder = useRef<Recorder | null>(null);
  const listener = useRef<Listener | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!talking) {
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt.current >= LONGEST_TURN_SECONDS * 1_000) {
        finish();
      }
    }, 500);
    return () => window.clearInterval(timer);
  });

  // Leaving the page stops listening, so the microphone is let go.
  useEffect(() => {
    return () => {
      listener.current?.abort();
      recorder.current?.stop();
    };
  }, []);

  function stopped() {
    listener.current = null;
    setTalking(false);
    setLive("");
  }

  function listenInTheBrowser() {
    listener.current = startListening(language, {
      onWords: setLive,
      onDone: (text) => {
        stopped();
        if (text === "") {
          onProblem("ansa didn't hear anything. Try again closer to the microphone, or type.");
        } else {
          onSaid({ text: text.slice(0, MOST_WORDS) }, text.slice(0, MOST_WORDS));
        }
      },
      onProblem: (message) => {
        stopped();
        onProblem(message);
      },
    });
  }

  async function start() {
    window.speechSynthesis?.cancel();
    startedAt.current = Date.now();
    setLive("");
    if (hearing === "browser") {
      setTalking(true);
      listenInTheBrowser();
      return;
    }
    try {
      recorder.current = await startRecording();
      setTalking(true);
    } catch (problem) {
      // The reason's name only (shown in the developer's terminal), never a recording.
      console.warn("practice phone: microphone refused:", problem instanceof Error ? problem.name : typeof problem);
      onProblem(microphoneProblem(problem));
    }
  }

  function finish() {
    if (listener.current) {
      // The browser sends what it heard once it has stopped (onDone).
      listener.current.stop();
      return;
    }
    const current = recorder.current;
    recorder.current = null;
    setTalking(false);
    if (current) {
      onSaid({ audio: current.stop(), language }, null);
    }
  }

  function cancel() {
    listener.current?.abort();
    recorder.current?.stop();
    recorder.current = null;
    stopped();
  }

  return { talking, live, start, finish, cancel };
}
