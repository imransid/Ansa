// The ansa phone app (the owner's design of 2026-11-04) as core gives it to
// the screens (core's /api/v1/devices): the JSON exactly as core writes it,
// so a time stays an RFC 3339 string. The app itself talks to core's own
// device API (/device/v1/...), never through the screens.

export type DevicePlatform = "ios" | "android";

// How long no connected phone may go without checking in before ansa
// switches to away by itself.
export type WaitMinutes = 1 | 5 | 15 | 30;

// One phone connected to the account. lastSeenAt: its last check-in ("" when
// it never checked in). reachable: it checked in within the wait.
export type ConnectedDevice = {
  id: string;
  name: string;
  platform: DevicePlatform;
  pairedAt: string;
  lastSeenAt: string;
  reachable: boolean;
};

// Settings → Your phone: the account's phones, the setting ("Answer for me
// when my phone is unreachable" and its wait), whether this person may change
// them (owners), and phoneAway: ansa is away because no phone was reachable
// (since when), else null.
export type DevicesPage = {
  devices: ConnectedDevice[];
  followPhone: boolean;
  waitMinutes: WaitMinutes;
  canChange: boolean;
  phoneAway: { since: string } | null;
};

// A one-time code to connect a phone (owners): 8 characters, one use, for 5
// minutes. link: the pairing link inside the QR code
// (ansa://pair?u=<core's device address>&c=<code>). qr: that link as a QR
// code's modules, one string of 0 and 1 per row (1 = dark), for the screens
// to draw; never HTML.
export type PairCode = {
  code: string;
  expiresAt: string;
  link: string;
  qr: { size: number; rows: string[] };
};

// Remove: "changed" = the phone wasn't connected any more (someone removed it first).
export type DeviceRemoveOutcome = "removed" | "changed";

export type DeviceSettingsOutcome = "saved";
