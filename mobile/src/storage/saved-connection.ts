// What the app keeps on the phone, and nothing more: the token core gave this
// phone, the server's address and the phone's name. All three live in the
// phone's secure storage (the iOS Keychain, Android's Keystore).
import * as SecureStore from "expo-secure-store";

export type SavedConnection = {
  serverUrl: string;
  token: string;
  phoneName: string;
};

const TOKEN_KEY = "ansa.deviceToken";
const SERVER_KEY = "ansa.serverUrl";
const NAME_KEY = "ansa.phoneName";

// WHY after first unlock: the background check-in runs while the phone is
// locked, and must still read the token then. It never leaves this phone
// (not in backups to another device).
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// The phone's connection, or null when it isn't connected.
export async function readSavedConnection(): Promise<SavedConnection | null> {
  const [token, serverUrl, phoneName] = await Promise.all([read(TOKEN_KEY), read(SERVER_KEY), read(NAME_KEY)]);
  if (!token || !serverUrl) return null;
  return { token, serverUrl, phoneName: phoneName ?? "" };
}

export async function saveConnection(connection: SavedConnection): Promise<void> {
  await SecureStore.setItemAsync(SERVER_KEY, connection.serverUrl, STORE_OPTIONS);
  await SecureStore.setItemAsync(NAME_KEY, connection.phoneName, STORE_OPTIONS);
  // The token last: a connection counts only once everything is there.
  await SecureStore.setItemAsync(TOKEN_KEY, connection.token, STORE_OPTIONS);
}

// Forgets the token. The server and the name stay, so connecting again
// starts from them.
export async function forgetToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY, STORE_OPTIONS).catch(() => undefined);
}

// The server and name used last, to fill in the connect screen.
export async function readLastServerAndName(): Promise<{ serverUrl: string | null; phoneName: string | null }> {
  const [serverUrl, phoneName] = await Promise.all([read(SERVER_KEY), read(NAME_KEY)]);
  return { serverUrl, phoneName };
}

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, STORE_OPTIONS);
  } catch {
    // An unreadable item (the phone still locked since it started) counts as missing.
    return null;
  }
}
