import { buildListUrl } from "@/lib/pagination";

// The address of one asset's card in the media library (step 39): the page
// of the library that shows it (50 to a page, newest first; null: unknown,
// so the first), at its card. WHY the page: an older file isn't on the
// first page, and a link to its card there would lead nowhere.
export function mediaLibraryLink(assetId: string, page: number | null): string {
  return `${buildListUrl("/cofounder/media", { page: page !== null && page > 1 ? page : null })}#asset-${assetId}`;
}
