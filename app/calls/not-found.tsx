import Link from "next/link";

// For a call the page can't show: unknown, mistyped, or another company's.
// All look the same. Shown below the app header (app/calls/layout.tsx).
export default function CallNotFound() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 p-6">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that call</h1>
      <p className="text-sm text-muted-foreground">
        Your company has no call at that address. The link may be mistyped or out of date.
      </p>
      <Link href="/calls" className="text-sm underline">
        &larr; All calls
      </Link>
    </main>
  );
}
