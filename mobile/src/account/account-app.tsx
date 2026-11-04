import { useEffect, useState } from "react";
import { BackHandler } from "react-native";
import type { Status } from "../api/types";
import type { SavedConnection } from "../storage/saved-connection";
import { HomeScreen } from "./home-screen";
import { SettingsScreen } from "./settings-screen";
import { useAccountSync } from "./use-account-sync";

type AccountAppProps = {
  connection: SavedConnection;
  // The status the pairing answered with, or null after a restart.
  initialStatus: Status | null;
  // The owner disconnected this phone here.
  onDisconnected: () => void;
  // ansa doesn't know this phone any more (removed on the website).
  onUnauthorized: () => void;
};

// The connected app: Home and Settings, checking in all the while (on
// either screen) through one useAccountSync.
export function AccountApp({ connection, initialStatus, onDisconnected, onUnauthorized }: AccountAppProps) {
  const sync = useAccountSync(connection, initialStatus, onUnauthorized);
  const [showSettings, setShowSettings] = useState(false);

  // Android's back button leaves Settings for Home, not the app.
  useEffect(() => {
    if (!showSettings) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowSettings(false);
      return true;
    });
    return () => subscription.remove();
  }, [showSettings]);

  if (showSettings) {
    return <SettingsScreen connection={connection} status={sync.status} onBack={() => setShowSettings(false)} onDisconnected={onDisconnected} />;
  }
  return <HomeScreen sync={sync} onOpenSettings={() => setShowSettings(true)} />;
}
