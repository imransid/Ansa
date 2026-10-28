import Link from "next/link";

// For a ticket number the page can't show: unknown, mistyped, or only in
// another company. All look the same, so nothing tells whether another
// company has that number. Shown below the app header (app/tickets/layout.tsx).
export default function TicketNotFound() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 p-6">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that ticket</h1>
      <p className="text-sm text-muted-foreground">
        Your company has no ticket with that number. The link may be mistyped or out of date.
      </p>
      <Link href="/dashboard" className="text-sm underline">
        &larr; All tickets
      </Link>
    </main>
  );
}
