# The ansa phone app

An iPhone and Android app (Expo, React Native, TypeScript) for the owner of
an ansa account. It does three things:

- **Connects** to the account by scanning the QR code on ansa's website
  (Settings → Your phone). Nobody types a login: the code is enough, works
  once, for 5 minutes.
- **Checks in** so ansa knows this phone is reachable. With "Answer for me
  when my phone is unreachable" switched on (on the website), ansa answers
  for the owner when none of their phones has checked in for the chosen
  minutes, and hands back when a phone checks in again.
- **Shows** what ansa does right now (Available / Away / Paused), with one
  button, "I'm away" or "I'm back", how many things need the owner, and
  what ansa did.

It talks only to core's device API (`/device/v1/pair`, `/heartbeat`, `/home`,
`/away`, `/unpair`; `core/internal/devices`), never to the screens or
anything else. It keeps three things on the phone, in its secure storage
(the iOS Keychain, Android's Keystore): the token core gave it, the server's
address and the phone's name.

It is its own npm project (npm, not pnpm: the rest of the repository uses
pnpm, and the root's TypeScript, ESLint and checks leave `mobile/` out).

## Run it on the laptop

Once:

```sh
cd mobile
npm install
```

Then, with core running (`pnpm demo` from the repository's root, or core on
its own):

```sh
npx expo start
```

and press `i` for the iPhone simulator or `a` for the Android emulator (start
the emulator first, e.g. from Android Studio's Device Manager). The first time,
Expo puts its free "Expo Go" app on the simulator; the ansa app runs inside it.

### Connect it

Log in to ansa's website as an owner and open Settings → Your phone: it shows
a QR code and the same code in letters (`XXXX-XXXX`).

- **Type the code instead.** The server is filled in already:
  `http://127.0.0.1:8080` on the iPhone simulator, `http://10.0.2.2:8080` on
  the Android emulator (the emulator's name for the laptop).
- **Or open the pairing link** (a simulator has no camera to scan with). Inside
  Expo Go the app answers Expo Go's links, so put the link's part after `?`
  behind `exp://<host>:8081/--/pair`:

  ```sh
  # iPhone simulator
  xcrun simctl openurl booted "exp://127.0.0.1:8081/--/pair?u=http%3A%2F%2F127.0.0.1%3A8080&c=K7P2QM9X"
  # Android emulator
  adb shell am start -a android.intent.action.VIEW -d "exp://10.0.2.2:8081/--/pair?u=http%3A%2F%2F127.0.0.1%3A8080\&c=K7P2QM9X"
  ```

  In a build of its own (`npx expo run:ios` / `npx expo run:android`, which
  needs Xcode or Android Studio and makes `ios/` and `android/`, both
  git-ignored) the app answers ansa's own links, exactly as the QR code holds
  them:

  ```sh
  xcrun simctl openurl booted "ansa://pair?u=http%3A%2F%2F127.0.0.1%3A8080&c=K7P2QM9X"
  adb shell am start -a android.intent.action.VIEW -d "ansa://pair?u=http%3A%2F%2F127.0.0.1%3A8080\&c=K7P2QM9X"
  ```

On the Android emulator the app reads `127.0.0.1` in a link as the laptop
(`10.0.2.2`), so the website's link works there unchanged.

## Run it on your own phone

1. Install **Expo Go** from the App Store or Google Play (free, no account).
2. Put the phone on the same Wi-Fi as the laptop.
3. Let core answer phones on the Wi-Fi: in `.env.core`, set
   `DEVICE_LISTEN_ADDR` to an address and port of its own, and
   `DEVICE_API_URL` to the laptop's address on that port, so the QR code
   carries an address the phone can reach. For example, with the laptop at
   `192.168.1.20`:

   ```sh
   DEVICE_LISTEN_ADDR=0.0.0.0:8085
   DEVICE_API_URL=http://192.168.1.20:8085
   ```

   (Not 8081, Expo's, nor ansa's own 3000, 8080 and 8090.) That listener serves the phone app's routes only,
   in development only; everything else of core stays on 127.0.0.1. Restart
   core.
4. `npx expo start` and scan the QR code it prints (the iPhone's Camera app,
   or Expo Go on Android). Then scan the code on ansa's website with
   "Scan the code".

## A test APK for an Android phone

The app itself, without Expo Go, built on this laptop (nothing is uploaded).
It needs Android Studio's SDK and JDK 17, and step 3 above. Build it in a
copy outside the repository:

```sh
cp -cR mobile /some/folder/mobile && cd /some/folder/mobile
ANSA_ALLOW_PLAIN_HTTP=1 CI=1 npx expo prebuild --platform android --clean --no-install
cd android && JAVA_HOME=<JDK 17> ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
# the APK: android/app/build/outputs/apk/release/app-release.apk (about 10 minutes the first time)
```

`ANSA_ALLOW_PLAIN_HTTP=1` lets the app reach core's development listener
over plain http; without it (a store build) the app speaks https only
(plugins/android-release.js, which also keeps a class the release build's
shrinking would drop: without it the app closed as soon as it opened). The
APK is signed with the template's debug key: for testing only. The app
takes core's address from the QR code, so when the laptop's Wi-Fi address
changes, change `DEVICE_API_URL` and restart core: the APK stays the same.

## Check-ins, and what phones allow

- **While the app is open** it checks in every 30 seconds, and at once when
  it comes back to the front. Home shows "Checked in just now", or
  "Can't reach ansa: check your internet".
- **In the background** it asks the phone to run a check-in now and then
  (`expo-background-task`). Phones decide when: every 15 minutes at best,
  often much less (iOS learns how the app is used, and waits longer for
  apps opened rarely; Android's battery saving does the same), and an
  iPhone runs nothing for an app swiped away from the app switcher. The
  iPhone simulator never runs background tasks, and Expo Go may not either:
  the Settings screen says when this phone doesn't.

So "unreachable" can only mean "hasn't checked in for N minutes". With a short
wait (1 or 5 minutes) a phone in a pocket, with the app closed, will often
count as unreachable and ansa will answer for its owner; a longer wait (15 or
30 minutes) fits a phone that is mostly in the background. Push notifications
would make this sharper, and need a push service (not built).

## Check it

```sh
npx tsc --noEmit                    # types
npx expo export --platform ios      # the bundle builds (writes dist/, git-ignored)
npx expo export --platform android
npx expo-doctor                     # package versions match the Expo SDK
```

## Versions

Expo SDK 58 (`expo` 58.0.23), React Native 0.88.1, React 19.3.0. Every
version in `package.json` is exact; add a package with `npx expo install
<name>` (it picks the SDK's version), then pin it.
