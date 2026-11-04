// What the connect screen starts with: the server address and the phone's
// name, both changeable there.
import * as Device from "expo-device";
import { Platform } from "react-native";
import type { Platform as DevicePlatform } from "../api/types";

export const PHONE_NAME_MAX_LENGTH = 60;

// Core's device API on the laptop during development. The iPhone simulator
// reaches the laptop at 127.0.0.1; the Android emulator at 10.0.2.2. A real
// phone on the Wi-Fi uses the laptop's own address (README.md).
export function defaultServerUrl(): string {
  return Platform.OS === "android" ? "http://10.0.2.2:8080" : "http://127.0.0.1:8080";
}

// On the Android emulator, 127.0.0.1 and localhost are the emulator itself;
// the laptop is 10.0.2.2. The website's pairing link names 127.0.0.1 during
// development, so on the emulator the app reads it as the laptop.
export function serverUrlForThisPhone(serverUrl: string): string {
  if (Platform.OS !== "android" || Device.isDevice) return serverUrl;
  return serverUrl.replace(/^(https?:\/\/)(127\.0\.0\.1|localhost)(?=[:/]|$)/i, (_whole, scheme: string) => `${scheme}10.0.2.2`);
}

export function devicePlatform(): DevicePlatform {
  return Platform.OS === "android" ? "android" : "ios";
}

// The phone's own name ("Rafa's iPhone"), else its model, else "My phone".
export function defaultPhoneName(): string {
  const candidates = [Device.deviceName, Device.modelName];
  for (const candidate of candidates) {
    const cleaned = cleanPhoneName(candidate ?? "");
    if (cleaned !== "") return cleaned;
  }
  return "My phone";
}

// A name as core takes it: one plain line of 1 to 60 characters. Control
// characters and line breaks become spaces; runs of spaces become one.
export function cleanPhoneName(name: string): string {
  const oneLine = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(oneLine).slice(0, PHONE_NAME_MAX_LENGTH).join("").trim();
}
