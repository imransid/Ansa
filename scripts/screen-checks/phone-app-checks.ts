// The ansa phone app's screens (the owner's design of 2026-11-04), on the
// pure helpers and on the code itself, as ui-polish-checks.ts does:
// Settings → Your phone connects the app with a QR code the screens draw
// from core's rows, lists the phones and whether each still checks in, and
// switches "Answer for me when my phone is unreachable"; Home says when the
// phone switched ansa to away. The API is the contract core follows
// (GET /api/v1/devices, POST pair-code, remove and settings).

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import {
  countdownText,
  isDrawableQr,
  isPairingLink,
  pairCodeForTyping,
  pairedWithCode,
  PLATFORM_LABELS,
  qrSquaresPath,
  WAIT_MINUTES,
  waitInWords,
} from "@/lib/devices";
import type { ConnectedDevice, PairCode } from "@/lib/types/devices";
import { check } from "./check";
import { read, withoutComments } from "./source-helpers";

const PAGE = "app/settings/phone";

// A phone as core lists it, connected at that time.
function phoneConnectedAt(pairedAt: string): ConnectedDevice {
  return { id: "d1", name: "Rafa's iPhone", platform: "ios", pairedAt, lastSeenAt: pairedAt, reachable: true };
}

export async function runPhoneAppChecks() {
  await check("phone app: the waits are core's (1, 5, 15 or 30 minutes), a code reads XXXX-XXXX, its countdown m:ss, and both platforms have a name", async () => {
    assert.deepEqual([...WAIT_MINUTES], [1, 5, 15, 30]);
    assert.equal(waitInWords(1), "1 minute");
    assert.equal(waitInWords(15), "15 minutes");
    assert.equal(pairCodeForTyping("K7P2QM9X"), "K7P2-QM9X");
    assert.equal(countdownText(299), "4:59");
    assert.equal(countdownText(5), "0:05");
    assert.deepEqual(PLATFORM_LABELS, { ios: "iPhone", android: "Android" });
  });

  await check("phone app: a QR code is drawn as runs of dark squares inside its 4-module quiet zone, only from rows of 0 and 1 as long as its size; only a pairing link is ever put in an href", async () => {
    assert.equal(qrSquaresPath(["101", "011", "000"]), "M4 4h1v1h-1zM6 4h1v1h-1zM5 5h2v1h-2z");
    assert.equal(qrSquaresPath(["000"]), "");
    assert.ok(isDrawableQr({ size: 2, rows: ["10", "01"] }));
    assert.ok(!isDrawableQr({ size: 3, rows: ["10", "01"] }), "fewer rows than its size");
    assert.ok(!isDrawableQr({ size: 2, rows: ["10", "0"] }), "a short row");
    assert.ok(!isDrawableQr({ size: 2, rows: ["1<", "01"] }), "something else than 0 and 1");
    assert.ok(!isDrawableQr({ size: 0, rows: [] }));
    assert.ok(isPairingLink("ansa://pair?u=http%3A%2F%2F127.0.0.1%3A8080&c=K7P2QM9X"));
    assert.ok(!isPairingLink("javascript:alert(1)"));
    assert.ok(!isPairingLink("https://example.com/ansa://pair?"));
  });

  await check("phone app: the phone a code connected is one connected after the code was made (its 5 minutes before it ran out, both core's clock), never one connected before", async () => {
    const pairCode: PairCode = { code: "K7P2QM9X", expiresAt: "2026-11-04T21:45:00Z", link: "ansa://pair?u=x&c=K7P2QM9X", qr: { size: 0, rows: [] } };
    assert.equal(pairedWithCode([phoneConnectedAt("2026-11-04T21:39:59Z")], pairCode), null);
    assert.equal(pairedWithCode([phoneConnectedAt("2026-11-04T21:41:10Z")], pairCode)?.name, "Rafa's iPhone");
    assert.equal(pairedWithCode([], pairCode), null);
  });

  await check("phone app: the types hold core's contract exactly, and every call goes to the contract's path with its body (POST {} where it takes nothing); Remove's \"changed\" is said, never taken for done", async () => {
    const types = withoutComments(await read("lib/types/devices.ts"));
    assert.match(types, /export type DevicePlatform = "ios" \| "android";/);
    assert.match(types, /export type WaitMinutes = 1 \| 5 \| 15 \| 30;/);
    assert.match(types, /id: string;\s*name: string;\s*platform: DevicePlatform;\s*pairedAt: string;\s*lastSeenAt: string;\s*reachable: boolean;/);
    assert.match(types, /devices: ConnectedDevice\[\];\s*followPhone: boolean;\s*waitMinutes: WaitMinutes;\s*canChange: boolean;\s*phoneAway: \{ since: string \} \| null;/);
    assert.match(types, /code: string;\s*expiresAt: string;\s*link: string;\s*qr: \{ size: number; rows: string\[\] \};/);
    assert.match(types, /export type DeviceRemoveOutcome = "removed" \| "changed";/);
    const views = withoutComments(await read("lib/core-views/devices.ts"));
    assert.equal((views.match(/callCore<DevicesPage>\("GET", "\/api\/v1\/devices"\)/g) ?? []).length, 2);
    assert.match(views, /callCore<PairCode>\("POST", "\/api\/v1\/devices\/pair-code", \{\}\)/);
    assert.match(views, /callCore<\{ outcome: DeviceRemoveOutcome \}>\("POST", `\/api\/v1\/devices\/\$\{encodeURIComponent\(id\)\}\/remove`, \{\}\)/);
    assert.match(views, /answer\.data\.outcome === "changed" \? \{ ok: false, errors: \{ message: ALREADY_REMOVED \} \} : \{ ok: true \}/);
    assert.match(views, /const body = \{ followPhone, waitMinutes: WAIT_MINUTES\.some\(\(choice\) => choice === minutes\) \? minutes : 0 \};/);
    assert.match(views, /callCore<\{ outcome: DeviceSettingsOutcome \}>\("POST", "\/api\/v1\/devices\/settings", body\)/);
    const actions = withoutComments(await read("app/actions/devices.ts"));
    assert.match(actions, /saveFollowPhoneThroughCore\(formData\.get\("followPhone"\) === "on", formData\.get\("waitMinutes"\)\)/);
    assert.match(actions, /removeDeviceThroughCore\(formData\.get\("deviceId"\)\)/);
    assert.match(actions, /const secondsLeft = Math\.max\(0, Math\.floor\(\(Date\.parse\(result\.pairCode\.expiresAt\) - Date\.now\(\)\) \/ 1000\)\);/);
  });

  await check("Settings → Your phone: its h1, the session read inside <Suspense> with its own address, refreshing itself every 5 seconds; owners connect (members are told an owner does), remove (asking first) and switch the setting (Save, then Saved.); members read it", async () => {
    const page = withoutComments(await read(`${PAGE}/page.tsx`));
    assert.match(page, /<h1 className="[^"]*">Your phone<\/h1>/);
    assert.match(page, /<Suspense fallback=\{<PageLoading \/>\}>\s*<PhoneSettings \/>/);
    assert.match(page.slice(page.indexOf("async function PhoneSettings(")), /await requireSessionContext\("\/settings\/phone"\);/);
    assert.match(page, /<RefreshEvery seconds=\{5\} \/>/);
    assert.match(page, /\{page\.canChange \? \(\s*<ConnectPhone devices=\{page\.devices\} \/>\s*\) : \(\s*<p[^>]*>An owner connects phones here\.<\/p>/);
    assert.match(page, /<PhoneList devices=\{page\.devices\} canRemove=\{page\.canChange\} \/>/);
    const list = withoutComments(await read(`${PAGE}/phone-list.tsx`));
    assert.match(list, /\{canRemove && \(\s*<ConfirmButton\s+action=\{removeDeviceAction\}\s+fields=\{\{ deviceId: device\.id \}\}/);
    assert.match(list, /<StatusDot tone="success">Reachable<\/StatusDot>/);
    assert.match(list, /last check-in <LocalDateTime iso=\{device\.lastSeenAt\} timeIfToday \/>/);
    const section = withoutComments(await read(`${PAGE}/follow-phone-section.tsx`));
    assert.match(section, /\{page\.canChange \? \(\s*<FollowPhoneForm followPhone=\{page\.followPhone\} waitMinutes=\{page\.waitMinutes\} \/>/);
    assert.match(section, /Only owners change it\./);
    const form = withoutComments(await read(`${PAGE}/follow-phone-form.tsx`));
    assert.match(form, /<Checkbox\s+name="followPhone"\s+defaultChecked=\{followPhone\}/);
    assert.match(form, /key=\{chosenWait\}\s+defaultValue=\{chosenWait\}/);
    assert.match(form, /startTransition\(\(\) => saveAction\(formData\)\)/);
    assert.match(form, /<SavedNote saved=\{state\?\.saved === true && !isSaving && !changedSinceSave\} \/>/);
    assert.match(form, /<FieldErrors id="waitMinutes-errors" errors=\{errors\?\.waitMinutes\} \/>/);
  });

  await check("Settings → Your phone: says what the setting does and, honestly, that phones pause apps in the background (a longer wait helps); an account answering always is told the phone changes nothing until ansa answers only when you're away, with a link to Settings → Assistant", async () => {
    const section = withoutComments(await read(`${PAGE}/follow-phone-section.tsx`)).replace(/\s+/g, " ");
    assert.ok(section.includes("ansa switches to away by itself and answers for you"));
    assert.ok(section.includes("It never ends an &ldquo;I&apos;m away&rdquo; you pressed yourself."));
    assert.ok(section.includes("Phones pause apps in the background"));
    assert.ok(section.includes("A longer wait makes that rarer."));
    assert.match(section, /\{answerWhen === "always" && <AnswersAlwaysNote kind=\{kind\} \/>\}/);
    assert.match(section, /<Link href="\/settings\/assistant#when-heading"/);
    assert.match(withoutComments(await read("app/settings/assistant/page.tsx")), /<h2 id="when-heading"/);
  });

  await check("Settings → Your phone: the QR code is the screens' own SVG of squares from core's rows, black on white in both themes, never HTML from core; the code shows as XXXX-XXXX with its countdown, and a new one once it ran out or connected a phone; a 'For developers' fold, development only, says how to run the app and open the link in a simulator", async () => {
    const qr = withoutComments(await read(`${PAGE}/qr-code.tsx`));
    assert.match(qr, /<rect width=\{side\} height=\{side\} fill="#ffffff" \/>/);
    assert.match(qr, /<path d=\{qrSquaresPath\(rows\)\} fill="#000000" \/>/);
    assert.match(qr, /const side = rows\.length \+ 2 \* QR_QUIET_ZONE;/);
    for (const file of await readdir(PAGE)) {
      assert.ok(!(await read(`${PAGE}/${file}`)).includes("dangerouslySetInnerHTML"), `${PAGE}/${file} puts HTML in the page`);
    }
    const connect = withoutComments(await read(`${PAGE}/connect-phone.tsx`));
    assert.match(connect, /\{isDrawableQr\(pairCode\.qr\) \? \(\s*<QrCode rows=\{pairCode\.qr\.rows\}/);
    assert.match(connect, /const typed = pairCodeForTyping\(pairCode\.code\);/);
    assert.match(connect, /Open the ansa app and scan this code\./);
    assert.match(connect, /\{countdownText\(secondsLeft\)\}/);
    assert.match(connect, /\{ranOut && <CodeButton [^>]*label="Show a new code"/);
    assert.match(connect, /\{connected && <CodeButton [^>]*label="Connect another phone"/);
    assert.match(connect, /\{isPairingLink\(pairCode\.link\) && \(/);
    assert.match(connect, /<p role="status"/);
    const notes = withoutComments(await read(`${PAGE}/developer-notes.tsx`));
    assert.match(notes, /if \(process\.env\.NODE_ENV === "production"\) \{\s*return null;/);
    assert.match(notes, /\{"cd mobile && npx expo start"\}/);
    assert.match(notes, /<kbd[^>]*>i<\/kbd> for the iPhone simulator or <kbd[^>]*>a<\/kbd> for the Android\s+emulator/);
    assert.match(notes, /A simulator can&apos;t scan: type the code in the app, or open the code&apos;s link in the simulator/);
    assert.match(notes, /xcrun simctl openurl booted '\$\{link\}'/);
  });

  await check("Settings lists Your phone for a business and for one person; Home's status card says when the phone switched ansa to away (it switches back by itself) with its one button, read from core's devices without failing Home when core can't say", async () => {
    const settings = withoutComments(await read("app/settings/page.tsx"));
    for (const list of ["const ASSISTANT_LINKS", "const PERSONAL_ASSISTANT_LINKS"]) {
      const start = settings.indexOf(list);
      assert.ok(start >= 0 && settings.slice(start, settings.indexOf("];", start)).includes('href: "/settings/phone", label: "Your phone"'), `${list} doesn't list Your phone`);
    }
    const home = withoutComments(await read("app/dashboard/page.tsx"));
    assert.match(home, /const \[home, phoneAway\] = await Promise\.all\(\[getHomeFromCore\(\), getPhoneAwayFromCore\(\)\]\);/);
    assert.match(home, /phoneAwaySince=\{phoneAway\?\.since \?\? null\}/);
    assert.match(withoutComments(await read("lib/core-views/devices.ts")), /return answer\.ok \? answer\.data\.phoneAway : null;/);
    const card = withoutComments(await read("app/dashboard/status-card.tsx"));
    const always = card.indexOf('if (availability.answerWhen === "always") {');
    const byPhone = card.indexOf("if (availability.awaySince && phoneAwaySince) {");
    const byYou = card.indexOf("if (availability.awaySince) {");
    assert.ok(always > 0 && always < byPhone && byPhone < byYou, "the phone's away isn't told apart from your own, after answering always");
    const phoneCase = card.slice(byPhone, byYou);
    assert.match(phoneCase, /Your phone has been unreachable since <LocalDateTime iso=\{phoneAwaySince\} timeIfToday \/>: ansa answers for you\./);
    assert.match(phoneCase, /It switches back by itself when your phone checks in again/);
    assert.match(phoneCase, /button: I_AM_BACK,/);
    assert.match(withoutComments(await read("components/local-date-time.tsx")), /const showsTodaysTime = timeIfToday && inBrowser && /);
  });

  await check("privacy: the policy says what the phone app keeps (its name, iPhone or Android, when it connected and last checked in, a token on the phone, the code only as a hash) and why", async () => {
    const stored = (await read("app/(marketing)/privacy/what-we-store.tsx")).replace(/\s+/g, " ");
    assert.ok(stored.includes("The ansa phone app: for each phone connected to your account, the name it gives itself"));
    assert.ok(stored.includes("whether it is an iPhone or an Android phone, when it was connected and when it last checked in"));
    assert.ok(stored.includes("The app keeps a token on the phone that lets it check in"));
    assert.ok(stored.includes("The one-time codes that connect a phone are kept only as a one-way hash."));
    assert.ok(stored.includes("whether it answers when your phone is unreachable"));
    const policy = (await read("app/(marketing)/privacy/page.tsx")).replace(/\s+/g, " ");
    assert.ok(policy.includes("answer for you while your phone doesn&apos;t check in"));
  });
}
