import type { PrivateFileAccess } from "@/lib/types/file-storage";

// The company's uploaded documents (Setup), as the page lists them and
// their download route reads one.

export type CompanyDocument = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
};

// A document's download, or why there is none: null for an unknown document
// (or another company's), "rate-limited" after too many downloads.
export type DocumentDownload = { access: PrivateFileAccess; fileName: string } | "rate-limited" | null;
