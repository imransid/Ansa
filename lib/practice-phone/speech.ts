// The browser's own speech for the practice phone (step 55, development
// only). Hearing: the browser's speech recognition, which in Chrome is
// Google's speech service (the caller's voice goes to Google; it hears
// Bangla well), or Whisper on this computer (recording.ts: nothing leaves
// it, weaker in Bangla). Speaking: a voice of the words' own language, when
// the browser has one.

// What the caller speaks: English or Bangla.
export type CallLanguage = "en" | "bn";

export const CALL_LANGUAGES: { value: CallLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "bn", label: "বাংলা (Bangla)" },
];

// How ansa hears the caller.
export type Hearing = "browser" | "whisper";

// The recognizer's language for each (Chrome needs a region).
const RECOGNITION_LANGUAGE: Record<CallLanguage, string> = { en: "en-US", bn: "bn-BD" };

// Bangla script (U+0980 to U+09FF): words written in it need a Bangla voice.
const BANGLA_SCRIPT = /[ঀ-৿]/;

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionClass = new () => Recognition;

// The browser's speech recognition, when it has one (Chrome, Edge, Safari).
function recognitionClass(): RecognitionClass | null {
  if (typeof window === "undefined") {
    return null;
  }
  const scope = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

// Whether this browser can hear the caller itself.
export function browserCanHear(): boolean {
  return recognitionClass() !== null;
}

export type Listener = { stop: () => void; abort: () => void };

type ListenHandlers = {
  // What it heard so far, shown while the caller talks.
  onWords: (text: string) => void;
  // All of it, once listening stops (also when the browser stops by itself).
  onDone: (text: string) => void;
  // Why it can't hear, in plain words.
  onProblem: (message: string) => void;
};

// Listens to the caller with the browser's recognition until stop().
export function startListening(language: CallLanguage, handlers: ListenHandlers): Listener {
  const Recognition = recognitionClass();
  if (!Recognition) {
    handlers.onProblem("This browser can't hear you itself: choose Whisper on this computer, or type.");
    return { stop: () => {}, abort: () => {} };
  }
  const recognition = new Recognition();
  recognition.lang = RECOGNITION_LANGUAGE[language];
  recognition.continuous = true;
  recognition.interimResults = true;
  let finished = "";
  let unfinished = "";
  let failed = false;
  recognition.onresult = (event) => {
    unfinished = "";
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      if (result.isFinal) {
        finished += result[0].transcript + " ";
      } else {
        unfinished += result[0].transcript;
      }
    }
    handlers.onWords((finished + unfinished).trim());
  };
  recognition.onerror = (event) => {
    // Silence, or our own abort: nothing to explain.
    if (event.error === "no-speech" || event.error === "aborted") {
      return;
    }
    failed = true;
    handlers.onProblem(recognitionProblem(event.error));
  };
  recognition.onend = () => {
    if (!failed) {
      handlers.onDone((finished + unfinished).trim());
    }
  };
  recognition.start();
  return {
    stop: () => recognition.stop(),
    abort: () => {
      failed = true;
      recognition.abort();
    },
  };
}

// Why the browser couldn't hear, and what to do (it names the reason only).
function recognitionProblem(error: string): string {
  const policy = (document as Document & { featurePolicy?: { allowsFeature: (feature: string) => boolean } }).featurePolicy;
  if (error === "not-allowed" && policy && !policy.allowsFeature("microphone")) {
    return "Reload this page (Cmd+R) and press Talk again: the browser lets this page use the microphone once it has loaded it itself.";
  }
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "The browser blocked the microphone for this page: click the icon at the left of the address bar, set Microphone to Allow, then reload the page. (On a Mac, also check System Settings → Privacy & Security → Microphone.)";
    case "network":
      return "The browser couldn't reach its speech service (Google's, in Chrome): check the internet connection, or choose Whisper on this computer.";
    case "audio-capture":
      return "No microphone was found, or another app is using it. Connect one or close the other app, or type instead.";
    case "language-not-supported":
      return "This browser can't hear that language: choose Whisper on this computer, or type.";
  }
  return `The browser couldn't hear you (${error}). Try again, type, or choose Whisper on this computer.`;
}

// The voices this browser has (Chrome loads them a moment after the page).
async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    return voices;
  }
  return new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    window.setTimeout(done, 1_000);
  });
}

// The browser's voice for a language ("bn", "en"): its default one first.
function voiceFor(voices: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice | null {
  const matching = voices.filter((voice) => voice.lang.toLowerCase().replace("_", "-").startsWith(language));
  return matching.find((voice) => voice.default) ?? matching[0] ?? null;
}

// Says ansa's words with a voice of their own language and resolves when it
// has finished; "no-voice" when the browser has none for Bangla (Chrome on a
// Mac): the words are only shown then.
export async function speak(words: string[]): Promise<"spoken" | "no-voice"> {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || words.length === 0) {
    return "spoken";
  }
  const text = words.join(" ");
  const bangla = BANGLA_SCRIPT.test(text);
  const voice = voiceFor(await loadVoices(), bangla ? "bn" : "en");
  if (bangla && voice === null) {
    return "no-voice";
  }
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang ?? navigator.language;
    if (voice) {
      utterance.voice = voice;
    }
    utterance.onend = () => resolve("spoken");
    utterance.onerror = () => resolve("spoken");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}
