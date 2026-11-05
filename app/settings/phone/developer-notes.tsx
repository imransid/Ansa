// How to try the ansa app on this computer, for whoever runs ansa here:
// folded away, closed, and left out of a production build (the page is also
// shown to people trying ansa). link: the shown code's pairing link, for a
// simulator that can't scan (null while no code is shown).
export function DeveloperNotes({ link }: { link: string | null }) {
  if (process.env.NODE_ENV === "production") {
    return null;
  }
  return (
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer hover:text-foreground">For developers</summary>
      <div className="grid gap-2 pt-2">
        <p>
          Run the app on this computer: <code className="text-foreground">{"cd mobile && npx expo start"}</code>, then press{" "}
          <kbd className="text-foreground">i</kbd> for the iPhone simulator or <kbd className="text-foreground">a</kbd> for the Android
          emulator.
        </p>
        <p>
          A simulator can&apos;t scan: type the code in the app, or open the code&apos;s link in the simulator
          {link ? ":" : " (press Connect your phone for a code)."}
        </p>
        {link && (
          <>
            <code className="block rounded-md bg-muted px-2 py-1 text-foreground wrap-anywhere">{`xcrun simctl openurl booted '${link}'`}</code>
            <code className="block rounded-md bg-muted px-2 py-1 text-foreground wrap-anywhere">
              {`adb shell "am start -a android.intent.action.VIEW -d '${link}'"`}
            </code>
          </>
        )}
        <p>
          The link tells the app where core is (core&apos;s DEVICE_API_URL). The iPhone simulator reaches this computer at
          http://127.0.0.1:8080, the Android emulator at http://10.0.2.2:8080, and a real phone on the Wi-Fi through core&apos;s
          DEVICE_LISTEN_ADDR.
        </p>
      </div>
    </details>
  );
}
