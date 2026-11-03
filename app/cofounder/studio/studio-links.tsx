import Link from "next/link";
import { COFOUNDER_PAGES } from "@/lib/cofounder/pages";

// Where the posts go next (step 58): the media library, the scheduled posts
// and the Marketing planner, which lists every other marketing page. The
// only way to them from Settings, on a phone too.
const NEXT_SEGMENTS: (string | null)[] = ["media", "queue", null];
const NEXT_PAGES = NEXT_SEGMENTS.flatMap((segment) => COFOUNDER_PAGES.filter((page) => page.segment === segment));

export function StudioLinks() {
  return (
    <nav aria-label="More for your posts" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {NEXT_PAGES.map((page) => (
        <Link key={page.href} href={page.href} className="font-medium text-link underline-offset-4 hover:underline">
          {page.label}
        </Link>
      ))}
    </nav>
  );
}
