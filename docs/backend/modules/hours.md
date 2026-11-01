# hours (core/internal/hours)

**What:** a business's weekly hours (opening hours, or a person's away hours)
read in its own time zone, as the old `lib/opening-hours.ts`.
**Shape:** `{"mon":[{"opens":"12:00","closes":"15:00"}, ...], ... "sun":[]}`:
all seven days, at most two times a day, "24:00" = closing at midnight.
Any other shape counts as "not given".
**Functions:** `Parse`, `DescribeDay` ("12:00 to 15:00 and 18:00 to
midnight", "Closed"), `Now` ("Open until 23:00", "Opens at 18:00", "Closed
now", "Closed today").
**Tests:** `hours_test.go`.
