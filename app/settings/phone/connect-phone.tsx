"use client";

import { useActionState, useEffect, useState } from "react";
import { startPairingAction } from "@/app/actions/devices";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { countdownText, isDrawableQr, isPairingLink, pairCodeForTyping, pairedWithCode } from "@/lib/devices";
import type { FormErrors } from "@/lib/form-result";
import type { ConnectedDevice, PairCode } from "@/lib/types/devices";
import { DeveloperNotes } from "./developer-notes";
import { QrCode } from "./qr-code";

// A code on screen, and until when it works by this browser's clock.
type ShownCode = { pairCode: PairCode; shownUntil: number };
type PairingState = { shown?: ShownCode; errors?: FormErrors };

const COULD_NOT_MAKE_A_CODE = "No code could be made just now. Try again in a moment.";

// Asks the server for a new code. Its deadline is this browser's clock plus
// the seconds the server counted: a browser whose clock is off still counts
// down right.
async function askForCode(): Promise<PairingState> {
  const answer = await startPairingAction();
  if (!answer.pairCode) {
    return { errors: answer.errors ?? { message: COULD_NOT_MAKE_A_CODE } };
  }
  return { shown: { pairCode: answer.pairCode, shownUntil: Date.now() + (answer.secondsLeft ?? 0) * 1000 } };
}

// Settings → Your phone → Connect your phone (owners): a one-time code for
// the ansa app, as a QR code to scan and as letters to type, with how long it
// still works. The page asks the server again every 5 seconds, so the phone
// that used the code shows up as connected by itself.
export function ConnectPhone({ devices }: { devices: ConnectedDevice[] }) {
  const [state, formAction, isPending] = useActionState<PairingState | undefined>(askForCode, undefined);
  const firstLabel = devices.length > 0 ? "Connect another phone" : "Connect your phone";
  if (state?.shown) {
    // Keyed by the code: a new code starts its own countdown.
    return <ShownCodePanel key={state.shown.pairCode.code} shown={state.shown} devices={devices} formAction={formAction} isPending={isPending} />;
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Install the ansa app on your phone, press the button, and scan the code it shows with the app. There is no password to type.
      </p>
      <CodeButton formAction={formAction} isPending={isPending} label={firstLabel} errors={state?.errors} />
      <DeveloperNotes link={null} />
    </div>
  );
}

type CodeButtonProps = { formAction: () => void; isPending: boolean; label: string; errors: FormErrors | undefined };

// The button that asks for a code (a new one, once one ran out or was used), and its refusal.
function CodeButton({ formAction, isPending, label, errors }: CodeButtonProps) {
  return (
    <form action={formAction} className="grid justify-items-start gap-2">
      <Button type="submit" disabled={isPending}>
        {isPending ? "One moment..." : label}
      </Button>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}

type ShownCodePanelProps = {
  shown: ShownCode;
  devices: ConnectedDevice[];
  // For the button that asks for another code.
  formAction: () => void;
  isPending: boolean;
};

// The code while it works, then what became of it: a phone connected with
// it, or it ran out. The status line is always there (empty meanwhile), so
// screen readers announce it when it says so.
function ShownCodePanel({ shown, devices, formAction, isPending }: ShownCodePanelProps) {
  const secondsLeft = useSecondsLeft(shown.shownUntil);
  const connected = pairedWithCode(devices, shown.pairCode);
  const ranOut = !connected && secondsLeft === 0;
  return (
    <div>
      <p role="status" className="not-empty:mb-4">
        {connected && <StatusDot tone="success">Connected: {connected.name}. It checks in from now on.</StatusDot>}
        {ranOut && <span className="text-sm">This code ran out: it no longer connects a phone.</span>}
      </p>
      <div className="grid gap-4">
        {connected && <CodeButton formAction={formAction} isPending={isPending} label="Connect another phone" errors={undefined} />}
        {ranOut && <CodeButton formAction={formAction} isPending={isPending} label="Show a new code" errors={undefined} />}
        {!connected && !ranOut && <CodeOnScreen pairCode={shown.pairCode} secondsLeft={secondsLeft} />}
        {!connected && <DeveloperNotes link={ranOut ? null : shown.pairCode.link} />}
      </div>
    </div>
  );
}

// The QR code, the same code as letters, and the time it still works.
function CodeOnScreen({ pairCode, secondsLeft }: { pairCode: PairCode; secondsLeft: number }) {
  const typed = pairCodeForTyping(pairCode.code);
  return (
    <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
      {isDrawableQr(pairCode.qr) ? (
        <QrCode rows={pairCode.qr.rows} label={`A QR code that connects your phone. The same code to type: ${typed}`} />
      ) : (
        <p className="text-sm text-muted-foreground">The QR code couldn&apos;t be drawn here: type the code in the app instead.</p>
      )}
      <div className="grid content-start gap-3">
        <p className="text-lg font-semibold">Open the ansa app and scan this code.</p>
        <div className="grid gap-1">
          <p className="text-sm text-muted-foreground">Or type it in the app:</p>
          <p className="font-mono text-3xl font-semibold tracking-widest">{typed}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          It works once, for <span className="tabular-nums">{countdownText(secondsLeft)}</span> more.
        </p>
        {isPairingLink(pairCode.link) && (
          <p className="text-sm">
            On the phone itself?{" "}
            <a href={pairCode.link} className="text-link hover:underline">
              Open it in the ansa app
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

// The whole seconds left until a deadline, by this browser's clock, again every second.
function useSecondsLeft(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
