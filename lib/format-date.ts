// Pages are rendered on the server, so times would otherwise follow the
// server's clock (your laptop in dev, UTC in production). Always UTC keeps
// them consistent. Known gap: viewers don't see their own local time yet.
const utcDateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

// Formats a date like "16 Oct 2026, 09:18". Label the column "(UTC)".
export function formatUtcDateTime(date: Date): string {
  return utcDateTimeFormat.format(date);
}
