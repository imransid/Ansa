"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { CALL_LANGUAGES, type CallLanguage, type Hearing } from "@/lib/practice-phone/speech";

type Props = {
  language: CallLanguage;
  onLanguage: (language: CallLanguage) => void;
  hearing: Hearing;
  onHearing: (hearing: Hearing) => void;
  // The browser can hear the caller itself (Chrome, Edge, Safari).
  canBrowserHear: boolean;
};

// The language the caller speaks, and how ansa hears them: the browser
// (Chrome: Google's speech service, good in Bangla) or Whisper on this
// computer (private, weaker in Bangla). ansa answers in the caller's language.
export function CallSettings({ language, onLanguage, hearing, onHearing, canBrowserHear }: Props) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="call-language">Language you&apos;ll speak</Label>
          <NativeSelect id="call-language" value={language} onChange={(event) => onLanguage(event.target.value === "bn" ? "bn" : "en")}>
            {CALL_LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="call-hearing">How ansa hears you</Label>
          <NativeSelect id="call-hearing" value={hearing} onChange={(event) => onHearing(event.target.value === "browser" ? "browser" : "whisper")}>
            {canBrowserHear && <option value="browser">This browser&apos;s speech service</option>}
            <option value="whisper">Whisper on this computer</option>
          </NativeSelect>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {hearing === "browser"
          ? "Your voice goes to the browser's speech service (Google's, in Chrome), which hears Bangla well."
          : "Your voice stays on this computer, but Whisper hears Bangla poorly and takes a few seconds."}
      </p>
    </div>
  );
}
