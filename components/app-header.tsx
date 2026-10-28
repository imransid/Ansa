import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { getSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getDashboardSummary } from "@/services/dashboard";

// The app's sections. Each section's layout says which one it is
// (components/app-frame.tsx), so the header marks it without reading the URL.
export type AppSection = "tickets" | "calls" | "emails" | "knowledge" | "cofounder" | "team" | "setup" | "billing" | "account";

const SECTION_LINKS: { section: AppSection; href: string; label: string }[] = [
  { section: "tickets", href: "/dashboard", label: "Tickets" },
  { section: "calls", href: "/calls", label: "Calls" },
  { section: "emails", href: "/emails", label: "Emails" },
  { section: "knowledge", href: "/knowledge", label: "Knowledge" },
  { section: "cofounder", href: "/cofounder", label: "Co-Founder" },
  { section: "team", href: "/team", label: "Team" },
  { section: "setup", href: "/setup", label: "Setup" },
];

// The "who you are" row and its placeholder share this: one line of fixed
// height that never wraps, so both take exactly the same space at every width.
const SIGNED_IN_ROW = "flex h-7 min-w-0 items-center gap-x-4 text-sm";

// The top bar of every signed-in page: the ansa name (back to the tickets),
// the sections with the current one marked, and below them who you are with
// Account, Billing (owners) and Log out. WHY in the layout, at one width: it
// no longer moves between list and ticket pages, and stays on screen while a
// page loads. Only the "who you are" row waits for the session. WHY a row of
// its own that never wraps: until the session arrives a placeholder holds its
// place, and the header must be as tall before as after. The real row's width
// depends on the address and company name, so beside the sections it would
// sometimes fit and sometimes wrap onto a new line, pushing the page down.
export function AppHeader({ section }: { section: AppSection }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-6">
      <header className="grid gap-y-3 border-b pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            ansa
          </Link>
          <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
            {SECTION_LINKS.map((link) => (
              <HeaderLink key={link.section} href={link.href} isCurrent={link.section === section}>
                {link.label}
              </HeaderLink>
            ))}
          </nav>
        </div>
        {/* Cache Components rule: the session is only known at request time. */}
        <Suspense fallback={<SignedInUserPlaceholder />}>
          <SignedInUser section={section} />
        </Suspense>
      </header>
    </div>
  );
}

async function SignedInUser({ section }: { section: AppSection }) {
  const session = await getSessionContext();
  // The page itself sends logged-out visitors to /login.
  if (!session) {
    return <SignedInUserPlaceholder />;
  }
  const summary = await getDashboardSummary(session);
  return (
    <div className={SIGNED_IN_ROW}>
      {/* truncate: a long address or company name is cut short with "..."
          (the whole sentence in the tooltip, and for screen readers) instead
          of wrapping the row or pushing the page wider than a phone. */}
      <p className="min-w-0 flex-1 truncate" title={`You are ${summary.email}, ${summary.role} at ${summary.companyName}`}>
        You are <strong>{summary.email}</strong>, {summary.role} at <strong>{summary.companyName}</strong>
      </p>
      <nav aria-label="Your account" className="flex shrink-0 gap-x-4 font-medium">
        <HeaderLink href="/account" isCurrent={section === "account"}>
          Account
        </HeaderLink>
        {/* Only a tidy menu: services/billing.ts refuses members anyway. */}
        {summary.role === "owner" && (
          <HeaderLink href="/billing" isCurrent={section === "billing"}>
            Billing
          </HeaderLink>
        )}
      </nav>
      <form action={logoutAction} className="shrink-0">
        <Button type="submit" variant="outline" size="sm">
          Log out
        </Button>
      </form>
    </div>
  );
}

function SignedInUserPlaceholder() {
  return (
    <div aria-hidden className={SIGNED_IN_ROW}>
      <div className="h-4 w-72 max-w-full rounded-md bg-muted" />
    </div>
  );
}

type HeaderLinkProps = {
  href: string;
  isCurrent: boolean;
  children: ReactNode;
};

// A header link; the current section is marked for sight and for screen
// readers (aria-current). whitespace-nowrap: on a phone the links wrap onto a
// second row as whole words, never "Co-" on one line and "Founder" below.
function HeaderLink({ href, isCurrent, children }: HeaderLinkProps) {
  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      className={cn(
        "rounded-sm whitespace-nowrap hover:text-foreground hover:underline",
        isCurrent ? "text-foreground underline underline-offset-4" : "text-muted-foreground",
      )}
    >
      {children}
    </Link>
  );
}
