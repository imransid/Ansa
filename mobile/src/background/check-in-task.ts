// The background check-in: when the phone lets ansa run in the background
// (at best every 15 minutes; phones decide, and often wait much longer), it
// tells core this phone is still reachable. Best effort: where background
// tasks don't exist (Expo Go on some phones, the iPhone simulator) nothing
// happens and nothing breaks.
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { checkIn, DeviceApiError } from "../api/device-api";
import { forgetToken, readSavedConnection } from "../storage/saved-connection";

const CHECK_IN_TASK = "ansa-background-check-in";

// The shortest wait phones allow between runs, in minutes.
const MINIMUM_INTERVAL_MINUTES = 15;

export type BackgroundCheckIns = "on" | "off" | "unavailable";

// Tells the phone what the task does. It must run when the app's code loads
// (index.ts), before React starts, because the phone may start the app in
// the background only to run it.
export function defineBackgroundCheckIn(): void {
  try {
    TaskManager.defineTask(CHECK_IN_TASK, runBackgroundCheckIn);
  } catch {
    // No background tasks here: the app works without them.
  }
}

async function runBackgroundCheckIn(): Promise<BackgroundTask.BackgroundTaskResult> {
  const connection = await readSavedConnection();
  if (!connection) return BackgroundTask.BackgroundTaskResult.Success;
  try {
    await checkIn(connection.serverUrl, connection.token);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    if (error instanceof DeviceApiError && error.kind === "unauthorized") {
      // Removed on the website: forget the token, so the app shows the
      // connect screen when it is next opened.
      await forgetToken();
      await stopBackgroundCheckIns();
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

// Asks the phone to run the check-in in the background (once connected).
export async function startBackgroundCheckIns(): Promise<void> {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(CHECK_IN_TASK)) return;
    await BackgroundTask.registerTaskAsync(CHECK_IN_TASK, { minimumInterval: MINIMUM_INTERVAL_MINUTES });
  } catch {
    // Best effort: without it the app still checks in while it is open.
  }
}

// Stops the background check-in (once disconnected).
export async function stopBackgroundCheckIns(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(CHECK_IN_TASK)) await BackgroundTask.unregisterTaskAsync(CHECK_IN_TASK);
  } catch {
    // Nothing was running.
  }
}

// For the Settings screen: does this phone run the check-in in the background?
export async function readBackgroundCheckIns(): Promise<BackgroundCheckIns> {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return "unavailable";
    return (await TaskManager.isTaskRegisteredAsync(CHECK_IN_TASK)) ? "on" : "off";
  } catch {
    return "unavailable";
  }
}
