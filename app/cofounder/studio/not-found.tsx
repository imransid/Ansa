import Link from "next/link";

// For a draft the page can't show: unknown, mistyped, or another company's.
// All look the same, so nothing tells whether another company has it. Shown
// below the app header and the Co-Founder's links (app/cofounder/layout.tsx).
export default function ContentDraftNotFound() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 p-6">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that draft</h1>
      <p className="text-sm text-muted-foreground">
        Your company has no draft at that address. The link may be mistyped or out of date.
      </p>
      <Link href="/cofounder/studio" className="text-sm underline">
        &larr; Content studio
      </Link>
    </main>
  );
}
