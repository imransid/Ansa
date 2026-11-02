# maintenance (core/internal/maintenance)

**What:** core's housekeeping (the old `db/maintenance.ts`,
`services/maintenance.ts`): deleting rows nobody can use any more, by age
alone. Nothing is read. Core's scheduler runs it every hour
([schedule](schedule.md)); it replaced the old backend's daily job.

**What goes:**
- rate limit counters whose window started over 48 hours ago (the longest
  window is a day; a day of slack so no live counter is reset);
- expired logins (`sessions`) and password reset links (`verifications`),
  Better Auth's own tables: refused anyway, this frees space;
- social connection attempts (`oauth_states`) past their 10 minutes;
- Telegram link codes past their 10 minutes and the hour a claimed one
  waits; Telegram accounts that waited their 70 minutes for a code in vain;
- core's own finished jobs (`core_jobs`, done or failed) 30 days after
  they ended (ids and codes only, kept that long to look into a failure).
  NEW: the old backend had no job table.

**How:** each delete removes at most 10,000 rows in one statement and
repeats until nothing is left or its table had 10 seconds (then "cleanup
stopped at its time limit" with the table as code; the rest waits for the
next run). WHY in batches: one statement deleting millions of rows could
run so long that it is rolled back whole, run after run. The age test is
repeated outside the batch's subquery, so a row that came back to life
meanwhile (a counter starting a new window) is kept. The deletes of a
company's tables are listed in CROSS_COMPANY.md.

**Not here (yet):** the old daily job's stuck work. Core's own work runs as
jobs with leases and retries ([jobs](jobs.md)), so an email or a reply
that core started is retried by itself; calls and image requests move with
their modules.

**Tests:** `cleanup_test.go` (live database, keeping to its own company: an
expired attempt and a 31-day-old finished job go; a live attempt, a
recent failed job and a waiting job stay).
