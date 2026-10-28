import "server-only";
import { htmlToPlainText } from "@/lib/html-to-text";
import { normalizeExtractedText } from "@/lib/knowledge/extract-text";
import { MAX_IMPORTED_CHARACTERS } from "@/lib/knowledge/limits";
import { canManageKnowledge } from "@/lib/knowledge/permissions";
import { toPlainSingleLine } from "@/lib/plain-text";
import { safeFetchText, type SafeFetchErrorCode, type SafeFetchSettings } from "@/lib/safe-fetch";
import type { SessionContext } from "@/lib/session";
import { webPageImportSchema } from "@/lib/validation/knowledge";
import { isOverImportLimit, saveImportedDrafts, TOO_MANY_IMPORTS, type ImportResult } from "./knowledge-import";

// "Import a web page" (step 34): one public page's text becomes draft
// articles of kind "website" with the page as their source. Owners only. The
// page is fetched by lib/safe-fetch.ts, which can't be pointed at anything
// private. One page only: links on it are not followed.
//
// LOGGING RULE for this file: never the URL or the page. One fixed line with
// the fetch's error code.

const FETCH_PROBLEMS: Record<SafeFetchErrorCode, string> = {
  invalid_url: "Use the page's full public https:// address.",
  not_https: "Use the page's full public https:// address.",
  port_not_allowed: "Use the page's address without a port number.",
  credentials_in_url: "Use the page's address without a user name or password.",
  private_address: "That address leads to a private network, so it can't be imported.",
  dns_failed: "No website answers at that address. Check it for typos.",
  too_many_redirects: "The page sent us on to other addresses too many times.",
  bad_redirect: "The page sent us on to an address that can't be used.",
  http_status: "The website answered with an error instead of the page.",
  wrong_type: "That address isn't a web page: only HTML and plain-text pages can be imported.",
  unsupported_encoding: "That website sent the page in a form we can't read.",
  too_large: "That page is over 2 MB, too big to import.",
  timeout: "The website took more than 10 seconds to send the page.",
  network_error: "The website could not be reached.",
};

// The <title> of a page is read from its first 100,000 characters only.
const TITLE_SEARCH_LENGTH = 100_000;

// Fetches one public web page and saves its text as draft articles of the
// session's company. fetchSettings: only the checks replace the network.
export async function importWebPageToKnowledgeForSession(
  session: SessionContext,
  input: unknown,
  fetchSettings: Partial<SafeFetchSettings> = {},
): Promise<ImportResult> {
  if (!canManageKnowledge(session.role)) {
    return refused("Only owners can import web pages.");
  }
  const parsed = webPageImportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: { url: parsed.error.issues.map((issue) => issue.message) } } };
  }
  if (await isOverImportLimit(session)) {
    return refused(TOO_MANY_IMPORTS);
  }
  const url = parsed.data.url;
  const page = await safeFetchText(url, fetchSettings);
  if (!page.ok) {
    console.error(`Knowledge web import failed: ${page.code}`);
    return { ok: false, errors: { fieldErrors: { url: [FETCH_PROBLEMS[page.code]] } } };
  }
  const isHtml = page.contentType === "text/html";
  const text = normalizeExtractedText(isHtml ? htmlToPlainText(page.text, MAX_IMPORTED_CHARACTERS + 1) : page.text);
  if (!text) {
    return refused("No text could be read from this page.");
  }
  const sourceName = (isHtml ? titleOfHtml(page.text) : null) ?? nameFromAddress(url);
  return saveImportedDrafts(session, { text, sourceName, kind: "website", source: { type: "url", url } });
}

// The text of the page's <title>, as one plain line, or null when it has none.
// indexOf, not a regular expression: a page full of unclosed <title> tags
// can't make this slow.
function titleOfHtml(html: string): string | null {
  const start = html.slice(0, TITLE_SEARCH_LENGTH);
  // Only A to Z are lower-cased. toLowerCase() makes some letters longer
  // (Turkish "İ" becomes two characters), which would move every position
  // found after one away from the same place in the page.
  const lowered = start.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const tagStart = lowered.indexOf("<title");
  const contentStart = tagStart === -1 ? -1 : lowered.indexOf(">", tagStart) + 1;
  const contentEnd = contentStart <= 0 ? -1 : lowered.indexOf("</title", contentStart);
  if (contentEnd === -1) {
    return null;
  }
  // htmlToPlainText decodes &amp; and the like.
  return toPlainSingleLine(htmlToPlainText(start.slice(contentStart, contentEnd), 300)) || null;
}

// "example.com/help/returns" for a page without a title.
function nameFromAddress(url: string): string {
  const { hostname, pathname } = new URL(url);
  return pathname === "/" ? hostname : `${hostname}${pathname}`;
}

function refused(message: string): ImportResult {
  return { ok: false, errors: { message } };
}
