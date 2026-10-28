import Link from "next/link";
import { cn } from "@/lib/utils";

export type FilterLink = {
  label: string;
  href: string;
  // The list on screen right now.
  isCurrent: boolean;
  // Something waits here for someone (tickets nobody has, stuck calls).
  needsAttention?: boolean;
};

// A row of plain links that switch what a list shows, with the current one
// marked for sight and for screen readers (aria-current).
export function FilterLinks({ label, links }: { label: string; links: FilterLink[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {links.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          aria-current={link.isCurrent ? "page" : undefined}
          className={cn(
            "hover:underline",
            link.isCurrent ? "font-semibold underline underline-offset-4" : "text-muted-foreground",
            link.needsAttention && !link.isCurrent && "font-medium text-destructive",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
