// Keeps the connected app in step with ansa: the check-in every 30 seconds
// while the app is open (and at once when it comes back to the front), Home's
// numbers after each one, pull to refresh, and "I'm away" / "I'm back".
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { checkIn, DeviceApiError, loadHome, setAway, type DeviceApiErrorKind } from "../api/device-api";
import type { ActivityLine, Status } from "../api/types";
import type { SavedConnection } from "../storage/saved-connection";

const CHECK_IN_EVERY_MS = 30_000;

export type AccountSync = {
  status: Status | null;
  needsYou: number | null;
  activity: ActivityLine[] | null;
  // When ansa last heard this phone check in.
  lastCheckIn: Date | null;
  // Why the last try to reach ansa didn't work; null when it did.
  problem: Exclude<DeviceApiErrorKind, "unauthorized"> | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  // Throws a DeviceApiError the caller shows (the status card).
  changeAway: (away: boolean) => Promise<void>;
};

export function useAccountSync(connection: SavedConnection, initialStatus: Status | null, onUnauthorized: () => void): AccountSync {
  const [status, setStatus] = useState<Status | null>(initialStatus);
  const [needsYou, setNeedsYou] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityLine[] | null>(null);
  const [lastCheckIn, setLastCheckIn] = useState<Date | null>(initialStatus ? new Date() : null);
  const [problem, setProblem] = useState<AccountSync["problem"]>(null);
  const [refreshing, setRefreshing] = useState(false);

  // WHY numbered requests: a check-in started before "I'm away" may answer
  // after it, with the status from before. Only an answer to a request
  // started later than the one shown may replace it.
  const requestsStarted = useRef(0);
  const newestShown = useRef(0);
  const showStatus = useCallback((requestNumber: number, newStatus: Status) => {
    if (requestNumber < newestShown.current) return;
    newestShown.current = requestNumber;
    setStatus(newStatus);
  }, []);

  // Kept in a ref so the timer below never restarts because of it.
  const onUnauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const noteFailure = useCallback((error: unknown) => {
    const kind = error instanceof DeviceApiError ? error.kind : "server";
    if (kind === "unauthorized") onUnauthorizedRef.current();
    else setProblem(kind);
  }, []);

  const loadHomeNumbers = useCallback(async () => {
    const requestNumber = ++requestsStarted.current;
    const home = await loadHome(connection.serverUrl, connection.token);
    showStatus(requestNumber, home.status);
    setNeedsYou(home.needsYou);
    setActivity(home.activity);
  }, [connection, showStatus]);

  // The check-in, then Home's numbers.
  const sync = useCallback(async () => {
    try {
      const requestNumber = ++requestsStarted.current;
      const answer = await checkIn(connection.serverUrl, connection.token);
      showStatus(requestNumber, answer.status);
      setLastCheckIn(new Date());
      setProblem(null);
      await loadHomeNumbers();
    } catch (error) {
      noteFailure(error);
    }
  }, [connection, loadHomeNumbers, noteFailure, showStatus]);

  useCheckInWhileOpen(sync);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await sync();
    setRefreshing(false);
  }, [sync]);

  const changeAway = useCallback(
    async (away: boolean) => {
      const requestNumber = ++requestsStarted.current;
      try {
        const answer = await setAway(connection.serverUrl, connection.token, away);
        showStatus(requestNumber, answer.status);
      } catch (error) {
        if (error instanceof DeviceApiError && error.kind === "unauthorized") onUnauthorizedRef.current();
        throw error;
      }
      // What ansa did may have changed too; a failure here waits for the next check-in.
      loadHomeNumbers().catch(() => undefined);
    },
    [connection, loadHomeNumbers, showStatus],
  );

  return { status, needsYou, activity, lastCheckIn, problem, refreshing, refresh, changeAway };
}

// Runs the check-in now and every 30 seconds while the app is on screen;
// stops in the background (the background task takes over there), and
// checks in at once when it comes back to the front.
function useCheckInWhileOpen(sync: () => Promise<void>): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      void sync();
      timer = setInterval(() => void sync(), CHECK_IN_EVERY_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    // WHY not "=== active": at launch iOS may still say "unknown" for a
    // moment, and no change event follows when it becomes active.
    if (AppState.currentState !== "background") start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      if (state === "background") stop();
    });
    return () => {
      subscription.remove();
      stop();
    };
  }, [sync]);
}
