// The named character references (&eacute;, &rsquo;, ...) that email HTML
// uses most, for lib/html-to-text.ts: Latin-1 letters and signs, typographic
// quotes and dashes, and a few symbols. Names are case-sensitive (&Eacute; is
// É, &eacute; is é). Any other name stays as it was written. Numeric ones
// (&#233;) are decoded by lib/html-to-text.ts itself.

// The names of characters 160 to 255 (Latin-1), in that order: the first is
// character 160 (no-break space), the last 255 (ÿ). The HTML standard's own table.
const LATIN1_NAMES = [
  "nbsp", "iexcl", "cent", "pound", "curren", "yen", "brvbar", "sect", "uml", "copy", "ordf", "laquo", "not", "shy", "reg", "macr",
  "deg", "plusmn", "sup2", "sup3", "acute", "micro", "para", "middot", "cedil", "sup1", "ordm", "raquo", "frac14", "frac12", "frac34", "iquest",
  "Agrave", "Aacute", "Acirc", "Atilde", "Auml", "Aring", "AElig", "Ccedil", "Egrave", "Eacute", "Ecirc", "Euml", "Igrave", "Iacute", "Icirc", "Iuml",
  "ETH", "Ntilde", "Ograve", "Oacute", "Ocirc", "Otilde", "Ouml", "times", "Oslash", "Ugrave", "Uacute", "Ucirc", "Uuml", "Yacute", "THORN", "szlig",
  "agrave", "aacute", "acirc", "atilde", "auml", "aring", "aelig", "ccedil", "egrave", "eacute", "ecirc", "euml", "igrave", "iacute", "icirc", "iuml",
  "eth", "ntilde", "ograve", "oacute", "ocirc", "otilde", "ouml", "divide", "oslash", "ugrave", "uacute", "ucirc", "uuml", "yacute", "thorn", "yuml",
];
const FIRST_LATIN1_CODE_POINT = 160;

// Other names, with their Unicode code points (as in the HTML standard).
const OTHER_CODE_POINTS: Record<string, number> = {
  quot: 34, QUOT: 34, amp: 38, AMP: 38, apos: 39, lt: 60, LT: 60, gt: 62, GT: 62, COPY: 169, REG: 174,
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  ensp: 8194, emsp: 8195, thinsp: 8201, ndash: 8211, mdash: 8212,
  lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
  dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243,
  lsaquo: 8249, rsaquo: 8250, euro: 8364, trade: 8482,
  larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, minus: 8722,
};

// The character a named reference stands for ("eacute" -> "é"), or null when
// the name isn't one of these.
export function decodeNamedEntity(name: string): string | null {
  const latin1Index = LATIN1_NAMES.indexOf(name);
  if (latin1Index !== -1) {
    return String.fromCodePoint(FIRST_LATIN1_CODE_POINT + latin1Index);
  }
  return Object.hasOwn(OTHER_CODE_POINTS, name) ? String.fromCodePoint(OTHER_CODE_POINTS[name]) : null;
}
