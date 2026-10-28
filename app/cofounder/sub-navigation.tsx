"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { COFOUNDER_PAGES } from "@/lib/cofounder/pages";
import { cn } from "@/lib/utils";

// The Co-Founder's own pages (lib/cofounder/pages.ts), on a row below the app
// header, as wide as it. The open page is marked for sight and for screen
// readers (aria-current). WHY a client component: the open page is read with
// useSelectedLayoutSegment, a client hook; the links themselves are fixed.
// On a phone the links wrap onto more rows, each a whole word.
export function CoFounderNavigation() {
  const openSegment = useSelectedLayoutSegment();
  return <CoFounderNavigationLinks openSegment={openSegment} />;
}

// The row itself. openSegment undefined: the open page isn't known yet, so
// none is marked. That is the placeholder the layout shows while a page
// with a number in its address (a plan version) streams in: the same links
// in the same place, so the row never jumps.
export function CoFounderNavigationLinks({ openSegment }: { openSegment?: string | null }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-4">
      <nav aria-label="Co-Founder pages" className="flex flex-wrap gap-x-5 gap-y-1 border-b pb-2 text-sm font-medium">
        {COFOUNDER_PAGES.map((page) => {
          const isOpen = page.segment === openSegment;
          return (
            <Link
              key={page.href}
              href={page.href}
              aria-current={isOpen ? "page" : undefined}
              className={cn(
                "rounded-sm whitespace-nowrap hover:text-foreground hover:underline",
                isOpen ? "text-foreground underline underline-offset-4" : "text-muted-foreground",
              )}
            >
              {page.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
