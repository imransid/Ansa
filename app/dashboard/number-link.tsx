import type { ReactNode } from "react";
import Link from "next/link";

// A plain row of a list on Home: tall enough for a thumb.
const LIST_LINK = "flex min-h-12 items-center rounded-sm py-2 hover:text-link";

// Every number on Home is one of these: a link to the page that lists it.
export function NumberLink({ href, className = LIST_LINK, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
