import "server-only";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { isSafeToUnpack } from "./docx-guard";

// Reads the text of an uploaded document for "Add to knowledge" (step 34):
// .txt, .md and .csv as UTF-8, .docx with mammoth, .pdf with unpdf (PDF.js).
// Only text: no pictures, no formatting. A scanned PDF holds pictures of
// pages, not text, so nothing can be read from it (no OCR).

export type ExtractedText =
  | { ok: true; text: string }
  // "no-text": the file opened but holds no readable text. "unreadable":
  // it is damaged, isn't what its name says, or a .docx unpacks too large.
  | { ok: false; reason: "no-text" | "unreadable" };

// The extensions services/documents.ts stores files under (lib/document-files.ts).
const PLAIN_TEXT_EXTENSIONS = new Set(["txt", "md", "csv"]);

// The text of one stored document, by the extension it was stored with.
export async function extractDocumentText(bytes: Buffer, extension: string): Promise<ExtractedText> {
  let raw: string | null;
  try {
    raw = await rawTextOf(bytes, extension);
  } catch {
    // The libraries' errors describe the file's insides: never logged here.
    raw = null;
  }
  if (raw === null) {
    return { ok: false, reason: "unreadable" };
  }
  const text = normalizeExtractedText(raw);
  return text ? { ok: true, text } : { ok: false, reason: "no-text" };
}

// Cleans text taken from a file or a web page: one kind of line break, no
// control characters but line breaks and tabs (Postgres refuses NUL, and the
// rest only hides or garbles text), at most one blank line in a row, and no
// spaces at the end of a line.
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n\t]/gu, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function rawTextOf(bytes: Buffer, extension: string): Promise<string | null> {
  if (PLAIN_TEXT_EXTENSIONS.has(extension)) {
    // The byte order mark some editors write first is no text.
    return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  }
  if (extension === "docx") {
    if (!isSafeToUnpack(bytes)) {
      return null;
    }
    return (await mammoth.extractRawText({ buffer: bytes })).value;
  }
  if (extension === "pdf") {
    return pdfText(bytes);
  }
  return null;
}

// All pages' text, one after the other. verbosity 0: PDF.js prints nothing
// but errors (its warnings can name what is inside the file).
async function pdfText(bytes: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
