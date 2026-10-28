import { z } from "zod";

// How many rows a list page shows.
export const PAGE_SIZE = 50;

// The highest page number we accept, so ?page=99999999 can't make the
// database skip billions of rows. Links never point past it (pageLinksFor).
export const MAX_PAGE = 10_000;

const pageNumberSchema = z.coerce.number().int().min(1).max(MAX_PAGE);

export type PageLinks = {
  // Where "Previous" and "Next" go, or null when there is no such page.
  previousPage: number | null;
  nextPage: number | null;
  // The last page a link can reach.
  lastPage: number;
  // More rows than MAX_PAGE pages hold: the oldest ones can only be found by searching.
  isCut: boolean;
};

// Reads ?page= from the URL. Anything missing or odd ("abc", "0", "-2", "1.5",
// a repeated ?page=1&page=2) quietly becomes page 1.
export function parsePageNumber(value: unknown): number {
  const parsed = pageNumberSchema.safeParse(typeof value === "string" ? value : undefined);
  return parsed.success ? parsed.data : 1;
}

// How many rows to skip in the database to reach this page.
export function pageOffset(page: number): number {
  return (page - 1) * PAGE_SIZE;
}

// How many pages a list of this many rows needs (at least 1, even when empty).
export function pageCount(totalRows: number): number {
  return Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
}

// Which pages "Previous" and "Next" lead to from this page. Never past
// MAX_PAGE: parsePageNumber turns a higher page into page 1, so a link there
// would quietly start the list over (step 29).
export function pageLinksFor(page: number, totalRows: number): PageLinks {
  const pagesNeeded = pageCount(totalRows);
  const lastPage = Math.min(pagesNeeded, MAX_PAGE);
  return {
    previousPage: page > 1 ? Math.min(page - 1, lastPage) : null,
    nextPage: page < lastPage ? page + 1 : null,
    lastPage,
    isCut: pagesNeeded > MAX_PAGE,
  };
}

// A list page's address with its filters: buildListUrl("/dashboard", { view:
// "open", q: null, page: 2 }) is "/dashboard?view=open&page=2". Empty values
// are left out, and every value is URL-encoded.
export function buildListUrl(basePath: string, query: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(name, String(value));
    }
  }
  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}
