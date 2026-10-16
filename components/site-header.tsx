import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { site } from "@/lib/site";

// The top bar of the public website (the app pages have AppHeader instead).
export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {site.name}
        </Link>
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/pricing" className="hover:underline">
            Pricing
          </Link>
          {/* The dashboard sends logged-out visitors to /login, and logged-in
              ones straight in, so this page can stay fully static. */}
          <Link href="/dashboard" className="hover:underline">
            Log in
          </Link>
          <Link href="/signup" className={buttonVariants({ size: "sm" })}>
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}
