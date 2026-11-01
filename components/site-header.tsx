import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

// The top bar of the public website (the app's pages have the sidebar
// instead, components/app-navigation.tsx): forest green, with the same one
// action as the page. overHero: on the home page it sits inside the hero
// and lets its green show through.
export function SiteHeader({ overHero = false }: { overHero?: boolean }) {
  return (
    <header className={cn("text-sidebar-foreground **:outline-sidebar-ring", !overHero && "bg-sidebar")}>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Link href="/" className="rounded-md">
          <BrandMark onGreen />
        </Link>
        <nav aria-label="Website" className="flex items-center gap-5 text-sm font-medium">
          <Link href="/#how-it-works" className="text-sidebar-muted-foreground hover:text-sidebar-foreground max-sm:hidden">
            How it works
          </Link>
          <Link href="/pricing" className="text-sidebar-muted-foreground hover:text-sidebar-foreground max-sm:hidden">
            Pricing
          </Link>
          {/* The dashboard sends logged-out visitors to /login, and logged-in
              ones straight in, so this page can stay fully static. */}
          <Link href="/dashboard" className="text-sidebar-muted-foreground hover:text-sidebar-foreground">
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-9 items-center rounded-xl px-3.5 font-semibold max-sm:hidden text-sidebar-foreground shadow-[inset_0_0_0_1px_rgb(246_241_228/0.35)] hover:bg-sidebar-accent"
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}
