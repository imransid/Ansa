// Pairing links that open the app: ansa://pair?u=...&c=... from the phone's
// own camera, a tap on a link, or `xcrun simctl openurl` / `adb shell am
// start` on a simulator (which has no camera).
import * as Linking from "expo-linking";
import { useEffect, useRef } from "react";
import { readPairingText, type PairingRequest } from "./pairing-link";

// Calls onRequest once for each pairing link the app is opened with.
export function usePairingLinks(onRequest: (request: PairingRequest) => void): void {
  const url = Linking.useURL();
  const handled = useRef(new Set<string>());
  const onRequestRef = useRef(onRequest);
  useEffect(() => {
    onRequestRef.current = onRequest;
  }, [onRequest]);

  useEffect(() => {
    // WHY remember them: the link that started the app stays the "current"
    // one, and must not connect the phone again after a disconnect.
    if (!url || handled.current.has(url)) return;
    handled.current.add(url);
    const request = readPairingText(url);
    // A bare code inside a link isn't a pairing link (only "pair" links count).
    if (request && request.serverUrl !== null) onRequestRef.current(request);
  }, [url]);
}
