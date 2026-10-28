import Link from "next/link";

// For a plan version the page can't show: a mistyped number, or one the
// company never had. Both look the same, so nothing tells whether another
// company has a plan with that number. Shown below the app header and the
// Co-Founder's links (app/cofounder/layout.tsx).
export default function PlanVersionNotFound() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 p-6">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that plan version</h1>
      <p className="text-sm text-muted-foreground">
        Your company has no marketing plan with that version number. The link may be mistyped or out of date.
      </p>
      <Link href="/cofounder/strategy" className="text-sm underline">
        &larr; Strategy
      </Link>
    </main>
  );
}
