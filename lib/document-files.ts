// Which files the Setup page accepts as company documents (step 16). Shared
// by the upload form in the browser and by services/documents.ts, so both
// refuse the same files with the same words. No server-only code here.

// Under Vercel's 4.5 MB request limit (next.config.ts allows 5 MB actions).
// A bigger file is refused in the browser before it is sent: the platform
// would cut the request off before our server could answer.
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

// Only plain document types, chosen by extension. Browsers report types like
// .md and .csv differently, so the stored type comes from this list, never
// from the browser. Downloads are always "save as", so a mislabelled file
// can't run in our pages.
const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// For the file picker's accept attribute: ".pdf,.txt,...".
export const DOCUMENT_EXTENSIONS_FOR_PICKER = Object.keys(DOCUMENT_TYPES)
  .map((extension) => `.${extension}`)
  .join(",");

export const TOO_BIG_MESSAGE = "Files can be at most 4 MB.";
export const WRONG_TYPE_MESSAGE = "Upload a PDF, Word (.docx), text, Markdown or CSV file.";
export const EMPTY_FILE_MESSAGE = "Choose a file to upload.";

export type DocumentCheck =
  | { ok: true; extension: string; contentType: string }
  | { ok: false; message: string };

// Says whether this file can be uploaded: the extension and the type we store
// for it, or why not, in the words the page shows.
export function checkDocumentFile(file: { name: string; size: number }): DocumentCheck {
  if (file.size === 0) {
    return { ok: false, message: EMPTY_FILE_MESSAGE };
  }
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  const contentType = Object.hasOwn(DOCUMENT_TYPES, extension) ? DOCUMENT_TYPES[extension] : undefined;
  if (!contentType) {
    return { ok: false, message: WRONG_TYPE_MESSAGE };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, message: TOO_BIG_MESSAGE };
  }
  return { ok: true, extension, contentType };
}
