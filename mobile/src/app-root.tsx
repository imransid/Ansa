import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { AccountApp } from "./account/account-app";
import type { Status } from "./api/types";
import { startBackgroundCheckIns, stopBackgroundCheckIns } from "./background/check-in-task";
import { ConnectScreen } from "./connect/connect-screen";
import { ConnectedMoment } from "./connect/connected-moment";
import type { PairingRequest } from "./pairing/pairing-link";
import { usePairingLinks } from "./pairing/use-pairing-links";
import { forgetToken, readSavedConnection, type SavedConnection } from "./storage/saved-connection";
import { usePalette } from "./theme/colors";

// Where the app is: reading the phone's storage, connecting, the moment
// right after connecting, or connected (Home and Settings).
type Stage =
  | { name: "starting" }
  | { name: "connect"; notice: string | null }
  | { name: "just-connected"; connection: SavedConnection; status: Status }
  | { name: "connected"; connection: SavedConnection; status: Status | null };

const REMOVED_NOTICE = "This phone was disconnected from ansa. To use it again, connect it with a new code.";

// The app's one decision: show the connect screen or the account.
export function AppRoot() {
  const palette = usePalette();
  const [stage, setStage] = useState<Stage>({ name: "starting" });
  const [incomingRequest, setIncomingRequest] = useState<PairingRequest | null>(null);

  useEffect(() => {
    readSavedConnection().then((connection) => {
      if (!connection) {
        setStage({ name: "connect", notice: null });
        return;
      }
      void startBackgroundCheckIns();
      setStage({ name: "connected", connection, status: null });
    });
  }, []);

  // A pairing link waits here until the connect screen takes it. On a
  // phone that is connected already, it is answered with a note instead.
  usePairingLinks(setIncomingRequest);
  const isConnected = stage.name === "connected" || stage.name === "just-connected";
  useEffect(() => {
    if (!isConnected || incomingRequest === null) return;
    setIncomingRequest(null);
    Alert.alert("This phone is already connected", "To connect it to another account, disconnect it in Settings first.");
  }, [isConnected, incomingRequest]);

  const onConnected = useCallback((connection: SavedConnection, status: Status) => {
    void startBackgroundCheckIns();
    setStage({ name: "just-connected", connection, status });
  }, []);

  const leaveMoment = useCallback(() => {
    setStage((current) => (current.name === "just-connected" ? { name: "connected", connection: current.connection, status: current.status } : current));
  }, []);

  const forgetConnection = useCallback((notice: string | null) => {
    void stopBackgroundCheckIns();
    void forgetToken();
    setStage({ name: "connect", notice });
  }, []);
  const onDisconnected = useCallback(() => forgetConnection(null), [forgetConnection]);
  const onUnauthorized = useCallback(() => forgetConnection(REMOVED_NOTICE), [forgetConnection]);

  if (stage.name === "starting") return <View style={{ flex: 1, backgroundColor: palette.frame }} />;
  if (stage.name === "connect") {
    return <ConnectScreen notice={stage.notice} incomingRequest={incomingRequest} onIncomingHandled={() => setIncomingRequest(null)} onConnected={onConnected} />;
  }
  if (stage.name === "just-connected") return <ConnectedMoment accountName={stage.status.accountName} onDone={leaveMoment} />;
  return <AccountApp connection={stage.connection} initialStatus={stage.status} onDisconnected={onDisconnected} onUnauthorized={onUnauthorized} />;
}
