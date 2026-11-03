import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { COFOUNDER_PAGES } from "@/lib/cofounder/pages";

// Every marketing page with its line (step 58): the Marketing planner is
// the one place they are all linked from, on a phone too (Settings → Social
// media posts → Marketing planner).
const PAGES = COFOUNDER_PAGES.filter((page) => page.segment !== null);

export function PlannerPages() {
  return (
    <section aria-labelledby="planner-pages" className="grid gap-2">
      <h2 id="planner-pages" className="text-lg font-semibold">
        Pages
      </h2>
      <ul className="max-w-3xl divide-y overflow-hidden rounded-xl border bg-card">
        {PAGES.map((page) => (
          <li key={page.href}>
            <Link href={page.href} className="flex items-center gap-4 px-4 py-3 hover:bg-accent focus-visible:bg-accent">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">{page.label}</span>
                <span className="text-sm text-muted-foreground">{page.description}</span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
