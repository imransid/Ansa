import { z } from "zod";

// How many rows a list page shows.
export const PAGE_SIZE = 50;

// The highest page number we accept, so ?page=99999999 can't make the
// database skip billions of rows.
const MAX_PAGE = 10_000;

const pageNumberSchema = z.coerce.number().int().min(1).max(MAX_PAGE);

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
