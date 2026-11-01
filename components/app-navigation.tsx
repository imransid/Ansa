import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { ConciergeBell, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isCoreOn } from "@/lib/core-api";
import { getSidebarFootFromCore } from "@/lib/core-views/sidebar";
import { getSessionContext, type SessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getAssistantGlanceForSession } from "@/services/assistant-settings";
import { getDashboardSummary } from "@/services/dashboard";

// The sidebar of every signed-in page on a laptop or tablet (from 768 pixels
// wide): the forest-green frame (step 44) with ansa's mark, the section
// links, and at its foot how the assistant answers, the restaurant with
// today's hours (step 45), and who you are with Account and Log out. It stays in
// place while the page scrolls. Only the foot waits for the session; it keeps
// a fixed height, the same as its placeholder, so nothing moves when the
// session arrives. Focus rings are brass here: green would vanish on green.
export function AppSidebar({ links }: { links: ReactNode }) {
  return (
    <div className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-7 bg-sidebar px-3 pt-5 pb-3 text-sidebar-foreground **:outline-sidebar-ring md:flex">
      <Link href="/dashboard" className="w-fit rounded-md px-3 py-1">
        <BrandMark onGreen />
      </Link>
      <nav aria-label="Sections">{links}</nav>
      <div className="mt-auto border-t border-sidebar-border pt-4">
        {/* Cache Components rule: the session is only known at request time. */}
        <Suspense fallback={<SignedInUserPlaceholder />}>
          <SignedInUser />
        </Suspense>
      </div>
    </div>
  );
}

// The phone's version (below 768 pixels): the same links in a bar floating
// above the bottom of the screen, within reach of a thumb, made of frosted
// glass so the page shows through as it scrolls (solid where a browser can't
// blur). Account and Log out are on the Settings page there. AppFrame pads
// the page so the bar never covers its end.
export function AppBottomBar({ links }: { links: ReactNode }) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 rounded-3xl bg-sheet shadow-float ring-1 ring-border supports-[backdrop-filter]:bg-sheet/75 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150 md:hidden"
    >
      {links}
    </nav>
  );
}

// Fixed height: the foot looks the same before and after the session arrives.
const SIGNED_IN_USER = "grid h-36 content-start gap-3 px-3";

async function SignedInUser() {
  const session = await getSessionContext();
  // The page itself sends logged-out visitors to /login.
  if (!session) {
    return <SignedInUserPlaceholder />;
  }
  // The new backend when it is switched on (lib/core-api.ts), else services/.
  const foot = isCoreOn() ? await getSidebarFootFromCore() : await readFootFromServices(session);
  if (!foot) {
    return <SignedInUserPlaceholder />;
  }
  const { summary, glance } = foot;
  return (
    <div className={SIGNED_IN_USER}>
      <span className="flex items-center gap-2 text-xs text-sidebar-foreground">
        <ConciergeBell aria-hidden className="size-4 shrink-0 text-sidebar-primary" />
        {glance.mode}
      </span>
      {/* truncate: a long company name or address is cut short with "..."
          (the whole of it in the tooltip) instead of widening the sidebar. */}
      <div className="grid min-w-0 gap-0.5" title={`You are ${summary.email}, ${summary.role} at ${summary.companyName}`}>
        <span className="truncate font-display text-lg leading-6 text-sidebar-foreground">{summary.companyName}</span>
        {glance.hours && (
          <span className="flex items-center gap-1.5 text-xs text-sidebar-muted-foreground">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", glance.hours.open ? "bg-sidebar-live" : "bg-sidebar-muted-foreground/60")} />
            {glance.hours.text}
          </span>
        )}
        <span className="truncate text-xs text-sidebar-muted-foreground">{summary.email}</span>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/account" className="rounded-sm text-sm text-sidebar-muted-foreground hover:text-sidebar-foreground hover:underline">
          Account
        </Link>
        <form action={logoutAction} className="ml-auto">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring"
          >
            <LogOut aria-hidden />
            Log out
          </Button>
        </form>
      </div>
    </div>
  );
}

// Who you are and your company, what ansa does now and today's hours, from services/.
async function readFootFromServices(session: SessionContext) {
  const [summary, glance] = await Promise.all([getDashboardSummary(session), getAssistantGlanceForSession(session)]);
  return { summary, glance };
}

function SignedInUserPlaceholder() {
  return (
    <div className={SIGNED_IN_USER}>
      <Skeleton className="h-4 w-32 bg-sidebar-accent" />
      <div className="grid gap-1.5">
        <Skeleton className="h-5 w-36 bg-sidebar-accent" />
        <Skeleton className="h-3.5 w-44 bg-sidebar-accent" />
      </div>
      <Skeleton className="h-8 w-full bg-sidebar-accent" />
    </div>
  );
}
