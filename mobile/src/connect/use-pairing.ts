// Connecting this phone to an ansa account with a code from ansa's website:
// the pair call, then the token saved on the phone.
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { DeviceApiError, pairPhone } from "../api/device-api";
import type { Status } from "../api/types";
import { cleanPhoneName, defaultPhoneName, devicePlatform } from "../pairing/phone-defaults";
import { saveConnection, type SavedConnection } from "../storage/saved-connection";

export type Pairing = {
  busy: boolean;
  error: string | null;
  pair: (code: string, serverUrl: string, phoneName: string) => Promise<void>;
  clearError: () => void;
};

export function usePairing(onConnected: (connection: SavedConnection, status: Status) => void): Pairing {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = useCallback(
    async (code: string, serverUrl: string, phoneName: string) => {
      const name = cleanPhoneName(phoneName) || defaultPhoneName();
      setBusy(true);
      setError(null);
      try {
        const answer = await pairPhone(serverUrl, { code, name, platform: devicePlatform() });
        const connection = { serverUrl, token: answer.token, phoneName: name };
        await saveConnection(connection);
        onConnected(connection, answer.status);
      } catch (failure) {
        setError(pairingErrorWords(failure, serverUrl));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      } finally {
        setBusy(false);
      }
    },
    [onConnected],
  );

  const clearError = useCallback(() => setError(null), []);
  return { busy, error, pair, clearError };
}

// What went wrong, in words for the person connecting.
function pairingErrorWords(failure: unknown, serverUrl: string): string {
  if (!(failure instanceof DeviceApiError)) return "Something went wrong on this phone. Try again.";
  if (failure.kind === "offline") return `Can't reach ansa at ${serverUrl.replace(/^https?:\/\//, "")}. Check the server address and your internet.`;
  // A wrong or expired code, or too many tries: core's own words.
  return failure.message;
}
