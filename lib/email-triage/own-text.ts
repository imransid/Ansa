// What Claude reads of an email body (step 28): only what the customer wrote
// this time. The earlier messages of a thread, forwarded messages and the
// signature are cut first, so other people's names, addresses and old
// messages never reach Claude (Rule: the smallest slice that does the job).
// The ticket still keeps and shows the whole email.
//
// Every pattern below is only what mail programs really write: a customer's
// own text that merely looks a bit like it ("From: London / Date: 20
// October", "On Monday I wrote to you:") must reach Claude, because Claude's
// summary and category (which routes the ticket) are made from it.

export type OwnText = {
  text: string;
  // Something of an earlier or forwarded message was removed (Claude is
  // told, so "see below" still makes sense to it).
  removedEarlierMessage: boolean;
};

// "On Mon, 19 Oct 2026 at 10:00, Jane <jane@x.com> wrote:" above a reply, in
// English and a few other languages ("Am ... schrieb Jane <...>:", "Le ... a
// écrit :"), on one line or wrapped over up to three (Gmail wraps long ones).
// Mail programs always put the sender's address or a clock time in it.
const ATTRIBUTION_START = /^(On|Am|Le|El|Op|Em|Il)\s/;
const ATTRIBUTION_VERB = /(?<!\p{L})(wrote|schrieb|écrit|escribió|schreef|escreveu|scritto)(?!\p{L})/iu;
const ATTRIBUTION_DETAIL = /[@<]|\d{1,2}:\d{2}/;
const MAX_ATTRIBUTION_LINES = 3;
// Real attributions are short; a longer line is never one (and stays cheap).
const MAX_ATTRIBUTION_CHARACTERS = 300;

// Outlook's header above an earlier message: "From: ..." with, within the
// next five lines, "Sent: ..." (or "Date: ...") AND "Subject: ...", in English
// and a few other languages ("*From:*" is how bold looks in plain text). A
// mail program's header always has the subject; a customer's own booking or
// shipping details ("From: London / Date: 20 October") don't.
const HEADER_FROM = /^\*?(From|De|Von|Van|Da)\s?:/i;
const HEADER_SENT = /^\*?(Sent|Date|Gesendet|Datum|Envoyé|Enviado|Enviada em|Verzonden|Inviato|Data)\s?:/i;
const HEADER_SUBJECT = /^\*?(Subject|Betreff|Objet|Asunto|Assunto|Onderwerp|Oggetto)\s?:/i;
const HEADER_LOOKAHEAD_LINES = 5;

// "-----Original Message-----", "---------- Forwarded message ---------" and
// the like: words between runs of five or more dashes. Only one of the words
// mail programs write there, or a "From:" line right below, makes it one: a
// customer's own "----- Problem one -----" is neither.
const SEPARATOR_DASHES = "-----";
const MAX_SEPARATOR_CHARACTERS = 200;
const SEPARATOR_WORDS = /original|origine|forward|weitergeleitet|ursprünglich|transféré|reenviado|encaminhad|oorspronkelijk|doorgestuurd|inoltrato/iu;
const APPLE_FORWARD_LINE = /^Begin forwarded message:?$/i;

// The signature delimiter (RFC 3676): a line of exactly "-- ", space included.
// WHY not "--" too: a customer may use "--" between their own points
// ("Order 1: broken / -- / Order 2: missing"), and that must reach Claude.
const SIGNATURE_DELIMITER = "-- ";

// A line that is empty or only a rule (Outlook puts "____" above its header).
const BLANK_OR_RULE_LINE = /^[\s_=*~-]*$/;

// Keeps what the customer wrote: "> " quoted lines and the "On ... wrote:"
// line above them go (the customer may have answered between quoted lines);
// an unquoted earlier thread (as in text made from HTML), an Outlook header
// block or a forwarded-message line cuts everything below it; and a signature
// after a "-- " line goes. When the customer wrote nothing above such a cut
// (a bare forward, or a contact form that starts with "From:" lines),
// nothing is cut: that text IS the request.
export function keepOwnText(body: string): OwnText {
  const lines = body.split(/\r\n|\r|\n/);
  const kept: string[] = [];
  let wroteSomething = false;
  let removedEarlierMessage = false;
  for (let index = 0; index < lines.length; index++) {
    const attributionLines = countAttributionLines(lines, index);
    if (attributionLines > 0 && isQuotedLine(nextTextLine(lines, index + attributionLines))) {
      removedEarlierMessage = true;
      index += attributionLines - 1;
      continue;
    }
    const startsEarlier = attributionLines > 0 || startsEarlierMessage(lines, index);
    if (startsEarlier && wroteSomething) {
      return { text: finishOwnText(kept), removedEarlierMessage: true };
    }
    if (isQuotedLine(lines[index])) {
      removedEarlierMessage = true;
      continue;
    }
    kept.push(lines[index]);
    // The first line of a bare forward ("---- Forwarded message ----") is
    // not something the customer wrote.
    if (!startsEarlier) {
      wroteSomething ||= /[\p{L}\p{N}]/u.test(lines[index]);
    }
  }
  return { text: finishOwnText(kept), removedEarlierMessage };
}

// How many lines (1 to 3) an attribution starting at this line takes, or 0.
function countAttributionLines(lines: string[], index: number): number {
  if (!ATTRIBUTION_START.test(lines[index].trim())) {
    return 0;
  }
  let joined = "";
  for (let count = 1; count <= MAX_ATTRIBUTION_LINES && index + count <= lines.length; count++) {
    joined = `${joined} ${lines[index + count - 1].trim()}`.trim();
    if (joined.length > MAX_ATTRIBUTION_CHARACTERS) {
      return 0;
    }
    if (joined.endsWith(":") && ATTRIBUTION_VERB.test(joined) && ATTRIBUTION_DETAIL.test(joined)) {
      return count;
    }
  }
  return 0;
}

// The first line from here on that isn't empty, trimmed ("" when there is none).
function nextTextLine(lines: string[], from: number): string {
  for (let index = from; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line !== "") {
      return line;
    }
  }
  return "";
}

function startsEarlierMessage(lines: string[], index: number): boolean {
  return isSeparatorLine(lines, index) || APPLE_FORWARD_LINE.test(lines[index].trim()) || isOutlookHeader(lines, index);
}

function isSeparatorLine(lines: string[], index: number): boolean {
  const line = lines[index].trim();
  if (!isDashedLine(line)) {
    return false;
  }
  return SEPARATOR_WORDS.test(line) || HEADER_FROM.test(nextTextLine(lines, index + 1));
}

// Words between runs of dashes. Written without a regular expression on
// purpose: a pattern with two ".*" would take far too long on many long lines
// of dashes (anyone can send one).
function isDashedLine(line: string): boolean {
  return (
    line.length <= MAX_SEPARATOR_CHARACTERS &&
    line.startsWith(SEPARATOR_DASHES) &&
    line.endsWith(SEPARATOR_DASHES) &&
    /\p{L}/u.test(line)
  );
}

function isOutlookHeader(lines: string[], index: number): boolean {
  if (!HEADER_FROM.test(lines[index].trim())) {
    return false;
  }
  const nextLines = lines.slice(index + 1, index + 1 + HEADER_LOOKAHEAD_LINES).map((line) => line.trim());
  return nextLines.some((line) => HEADER_SENT.test(line)) && nextLines.some((line) => HEADER_SUBJECT.test(line));
}

function isQuotedLine(line: string): boolean {
  return line.trimStart().startsWith(">");
}

// Drops the signature (from the last "-- " line on) and the empty or rule
// lines left at the end.
function finishOwnText(kept: string[]): string {
  const signatureStart = kept.lastIndexOf(SIGNATURE_DELIMITER);
  const ownLines = signatureStart === -1 ? [...kept] : kept.slice(0, signatureStart);
  while (ownLines.length > 0 && BLANK_OR_RULE_LINE.test(ownLines[ownLines.length - 1])) {
    ownLines.pop();
  }
  return ownLines.join("\n").trim();
}
