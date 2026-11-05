import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import { WAIT_MINUTES } from "@/lib/devices";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { DeviceRemoveOutcome, DeviceSettingsOutcome, DevicesPage, PairCode } from "@/lib/types/devices";

// The ansa phone app through core (/api/v1/devices): Settings → Your phone
// (the connected phones, a code to connect one, Remove, and "Answer for me
// when my phone is unreachable") and Home's "your phone is unreachable".
// Owners connect, remove and change the setting; core refuses members.

// Said next to Remove when the phone was gone already: the page, refreshed, no longer lists it.
const ALREADY_REMOVED = "This phone isn't connected any more.";

// The account's phones and the setting, as Settings → Your phone shows them.
export async function getDevicesFromCore(): Promise<DevicesPage> {
  const answer = await callCore<DevicesPage>("GET", "/api/v1/devices");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return answer.data;
}

// Since when ansa has been away because no phone was reachable, for Home's
// status card: null when it isn't, or when core couldn't say (Home then
// shows the plain "You're away" instead of failing the whole page).
export async function getPhoneAwayFromCore(): Promise<{ since: string } | null> {
  const answer = await callCore<DevicesPage>("GET", "/api/v1/devices");
  return answer.ok ? answer.data.phoneAway : null;
}

// "Connect your phone": a new one-time code, its link and its QR code.
export async function startPairingThroughCore(): Promise<{ ok: true; pairCode: PairCode } | { ok: false; errors: FormErrors }> {
  const answer = await callCore<PairCode>("POST", "/api/v1/devices/pair-code", {});
  return answer.ok ? { ok: true, pairCode: answer.data } : { ok: false, errors: toFormErrors(answer) };
}

// Remove: the phone stops checking in and the app forgets this account.
// The id is only a claim from a form: core checks it is the session's company's.
export async function removeDeviceThroughCore(deviceId: unknown): Promise<FormResult> {
  // An empty id would put "//" in the path; "missing" is no phone's id, so
  // core answers that it isn't there.
  const id = typeof deviceId === "string" && deviceId !== "" ? deviceId : "missing";
  const answer = await callCore<{ outcome: DeviceRemoveOutcome }>("POST", `/api/v1/devices/${encodeURIComponent(id)}/remove`, {});
  if (!answer.ok) {
    return { ok: false, errors: toFormErrors(answer) };
  }
  return answer.data.outcome === "changed" ? { ok: false, errors: { message: ALREADY_REMOVED } } : { ok: true };
}

// "Answer for me when my phone is unreachable" and its wait. A wait that
// isn't one of the choices is sent as 0, which core refuses.
export async function saveFollowPhoneThroughCore(followPhone: boolean, waitMinutes: unknown): Promise<FormResult> {
  const minutes = Number(waitMinutes);
  const body = { followPhone, waitMinutes: WAIT_MINUTES.some((choice) => choice === minutes) ? minutes : 0 };
  return savedOrErrors(await callCore<{ outcome: DeviceSettingsOutcome }>("POST", "/api/v1/devices/settings", body));
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}
