import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found - ansa" };

// For an address that leads nowhere. Tickets and calls that don't exist have
// their own pages below the app header (app/tickets/not-found.tsx and
// app/calls/not-found.tsx). Without this, Next.js would show its own bare
// "404" page with no way back.
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="grid max-w-md gap-4">
        <h1 className="text-xl font-semibold">We couldn&apos;t find that ticket or page</h1>
        <p className="text-sm text-muted-foreground">
          The link may be mistyped or out of date. If someone sent it to you, ask them to check it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard" className={buttonVariants()}>
            Go to your tickets
          </Link>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            ansa home
          </Link>
        </div>
      </div>
    </main>
  );
}
