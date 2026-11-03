"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { connectWhatsAppAction } from "@/app/actions/channels";
import { Button } from "@/components/ui/button";
import type { WhatsAppSignup } from "@/lib/core-views/channels";

// Meta's JavaScript SDK, as Meta's Embedded Signup documentation loads it.
const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const GRAPH_VERSION = "v26.0";

type FacebookSDK = {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: { authResponse?: { code?: string } | null }) => void, options: Record<string, unknown>) => void;
};
type WithFacebook = Window & { FB?: FacebookSDK; fbAsyncInit?: () => void };

// The number Meta's window reports when the business finishes (FINISH: a
// new number; FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING: the number of their
// WhatsApp Business app). Claims: core asks Meta about each before saving.
type Reported = { wabaId: string; phoneNumberId: string };

// Only Meta's own pages may report a sign-up.
function isFacebook(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

function readReport(data: unknown): Reported | null {
  let message: unknown = data;
  if (typeof data === "string") {
    try {
      message = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const report = message as { type?: unknown; event?: unknown; data?: { waba_id?: unknown; phone_number_id?: unknown } };
  if (report?.type !== "WA_EMBEDDED_SIGNUP" || (report.event !== "FINISH" && report.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")) {
    return null;
  }
  return { wabaId: String(report.data?.waba_id ?? ""), phoneNumberId: String(report.data?.phone_number_id ?? "") };
}

// Meta's SDK, loaded once per page.
let sdkLoading: Promise<FacebookSDK> | null = null;

// Loads Meta's SDK once and resolves when it is ready.
function loadSDK(appId: string): Promise<FacebookSDK> {
  const scope = window as WithFacebook;
  if (scope.FB) {
    return Promise.resolve(scope.FB);
  }
  if (sdkLoading) {
    return sdkLoading;
  }
  sdkLoading = new Promise((resolve, reject) => {
    scope.fbAsyncInit = () => {
      scope.FB?.init({ appId, autoLogAppEvents: true, xfbml: true, version: GRAPH_VERSION });
      if (scope.FB) {
        resolve(scope.FB);
      }
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkLoading = null;
      reject(new Error("sdk"));
    };
    document.body.appendChild(script);
  });
  return sdkLoading;
}

// Meta's window reports the number in a message of its own, which may
// arrive just after the code: wait for it a moment (the code lasts 30 s).
async function reportedSoon(reported: { current: Reported | null }): Promise<Reported | null> {
  for (let tries = 0; tries < 20 && !reported.current; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return reported.current;
}

// "Connect WhatsApp" (step 56): opens Meta's sign-up window (Embedded
// Signup, with the WhatsApp Business app's number allowed: coexistence),
// then hands Meta's one-time code (it works for 30 seconds) and the number
// Meta reported to core at once.
export function WhatsAppSignupButton({ signup }: { signup: WhatsAppSignup }) {
  const [error, setError] = useState("");
  const [isSaving, startSaving] = useTransition();
  const [isOpen, setOpen] = useState(false);
  const reported = useRef<Reported | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFacebook(event.origin)) {
        return;
      }
      const report = readReport(event.data);
      if (report) {
        reported.current = report;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function open() {
    setError("");
    reported.current = null;
    let sdk: FacebookSDK;
    try {
      sdk = await loadSDK(signup.appId);
    } catch {
      setError("Meta's sign-up couldn't load. Check the internet connection, or turn off a blocker for this page, then try again.");
      return;
    }
    setOpen(true);
    sdk.login(
      (response) => {
        setOpen(false);
        const code = response.authResponse?.code;
        startSaving(async () => {
          const report = code ? await reportedSoon(reported) : null;
          if (!code || !report) {
            setError("Meta's sign-up didn't finish, so nothing changed. Press Connect WhatsApp to try again.");
            return;
          }
          const result = await connectWhatsAppAction({ code, wabaId: report.wabaId, phoneNumberId: report.phoneNumberId });
          if (result.error) {
            setError(result.error);
          }
        });
      },
      {
        config_id: signup.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <div className="grid justify-items-start gap-2">
      <Button type="button" onClick={() => void open()} disabled={isOpen || isSaving}>
        {isSaving ? "Connecting..." : isOpen ? "Finish in Meta's window..." : "Connect WhatsApp"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
