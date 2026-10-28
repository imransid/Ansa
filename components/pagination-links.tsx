import Link from "next/link";
import { buildListUrl, MAX_PAGE, pageLinksFor } from "@/lib/pagination";

type PaginationLinksProps = {
  // The list's own path, e.g. "/dashboard". The page goes in ?page=.
  basePath: string;
  page: number;
  totalRows: number;
  // The list's filters (?view=, ?q=, ...), kept on both links so the next
  // page shows the same list. Empty values are left out.
  query?: Record<string, string | null>;
};

// "Page 2 of 5" with Previous / Next links. Hidden when everything fits on one page.
export function PaginationLinks({ basePath, page, totalRows, query = {} }: PaginationLinksProps) {
  const links = pageLinksFor(page, totalRows);
  if (links.lastPage <= 1 && page <= 1) {
    return null;
  }

  return (
    <nav aria-label="Pages" className="grid gap-1 text-sm">
      <div className="flex items-center gap-4">
        {links.previousPage ? (
          <Link href={buildListUrl(basePath, { ...query, page: links.previousPage })} className="underline">
            &larr; Previous
          </Link>
        ) : (
          <span className="text-muted-foreground">&larr; Previous</span>
        )}
        <span>
          Page {page} of {links.lastPage}
        </span>
        {links.nextPage ? (
          <Link href={buildListUrl(basePath, { ...query, page: links.nextPage })} className="underline">
            Next &rarr;
          </Link>
        ) : (
          <span className="text-muted-foreground">Next &rarr;</span>
        )}
      </div>
      {links.isCut && (
        <p className="text-muted-foreground">
          Lists stop at page {MAX_PAGE.toLocaleString("en-US")}. Search to find older ones.
        </p>
      )}
    </nav>
  );
}
