import Link from "next/link";
import { pageCount } from "@/lib/pagination";

type PaginationLinksProps = {
  // The list's own path, e.g. "/dashboard". The page goes in ?page=.
  basePath: string;
  page: number;
  totalRows: number;
};

// "Page 2 of 5" with Previous / Next links. Hidden when everything fits on one page.
export function PaginationLinks({ basePath, page, totalRows }: PaginationLinksProps) {
  const lastPage = pageCount(totalRows);
  if (lastPage <= 1 && page <= 1) {
    return null;
  }

  return (
    <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
      {page > 1 ? (
        <Link href={`${basePath}?page=${Math.min(page - 1, lastPage)}`} className="underline">
          &larr; Previous
        </Link>
      ) : (
        <span className="text-muted-foreground">&larr; Previous</span>
      )}
      <span>
        Page {page} of {lastPage}
      </span>
      {page < lastPage ? (
        <Link href={`${basePath}?page=${page + 1}`} className="underline">
          Next &rarr;
        </Link>
      ) : (
        <span className="text-muted-foreground">Next &rarr;</span>
      )}
    </nav>
  );
}
