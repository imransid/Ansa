import type { ReactNode } from "react";

// An email's plain text with its links to ansa itself made clickable (the
// confirmation, reset and invite links are "#..." links into this app). Any
// other address stays plain text: the development mailbox shows what was
// written, it doesn't send anyone anywhere else.
export function DevMailText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const [link] = match;
    const at = rest.indexOf(link);
    parts.push(rest.slice(0, at));
    parts.push(isOwnLink(link) ? <a key={key++} href={new URL(link).pathname + new URL(link).hash} className="text-link underline">{link}</a> : link);
    rest = rest.slice(at + link.length);
  }
  parts.push(rest);
  return <p className="text-sm whitespace-pre-wrap wrap-anywhere">{parts}</p>;
}

// A link into this app (the same address the page runs on, in development
// http://localhost:3000).
function isOwnLink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
