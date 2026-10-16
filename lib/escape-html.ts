// Makes text safe to put inside HTML. Use it for every value that comes from a
// user, a customer or the AI (names, subjects, ...), so "<script>" shows up as
// text instead of running.
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
