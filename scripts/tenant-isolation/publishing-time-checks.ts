// Publishing queue checks (step 41) on the pure pieces: a date and time
// typed in the viewer's own timezone becomes the right UTC instant (and the
// schedule form sends that instant, made in its onSubmit); the window a
// time must fall in; a draft's status from its posts; a 429's wait; a
// post's address kept only on its platform's own hosts; plain words for
// every code a post can stop with. No database.

import assert from "node:assert/strict";
import { describeJobError, publishJobErrorCodes } from "@/lib/publishing/job-errors";
import { secondsUntilNextTry } from "@/lib/publishing/retry-timing";
import { draftStatusFromJobs } from "@/lib/publishing/draft-status";
import type { PublishJobStatus } from "@/lib/publishing/kinds";
import { readPostUrl } from "@/lib/publishing/post-urls";
import { addDays, checkScheduleTime, isKnownTimeZone, localDateOf, localTimeOf, wallClockToUtc } from "@/lib/publishing/schedule-time";
import { publishErrorCodes } from "@/lib/social-errors";
import { check } from "./helpers";
import { read, withoutComments } from "./source-helpers";

// The instant, as an ISO string, of a wall-clock time in a timezone.
function utcOf(date: string, time: string, timeZone: string): string | null {
  return wallClockToUtc({ date, time }, timeZone)?.toISOString() ?? null;
}

export async function runPublishingTimeChecks() {
  await check("schedule times: a date and time typed in a timezone other than UTC is stored as the right UTC instant (Lisbon, Kolkata, New York, Kiritimati); a skipped hour moves past the jump, a repeated one takes the first; odd dates, times and timezones give nothing", async () => {
    assert.equal(utcOf("2026-11-03", "09:30", "Europe/Lisbon"), "2026-11-03T09:30:00.000Z");
    assert.equal(utcOf("2026-07-03", "09:30", "Europe/Lisbon"), "2026-07-03T08:30:00.000Z");
    assert.equal(utcOf("2026-11-03", "09:30", "Asia/Kolkata"), "2026-11-03T04:00:00.000Z");
    assert.equal(utcOf("2026-11-03", "09:30", "America/New_York"), "2026-11-03T14:30:00.000Z");
    assert.equal(utcOf("2026-12-31", "23:59", "Pacific/Kiritimati"), "2026-12-31T09:59:00.000Z");
    assert.equal(utcOf("2026-11-03", "09:30", "UTC"), "2026-11-03T09:30:00.000Z");
    // New York's clocks jump from 02:00 to 03:00 on 2027-03-14: 02:30 never happens there.
    assert.equal(utcOf("2027-03-14", "02:30", "America/New_York"), "2027-03-14T07:30:00.000Z");
    // And go back from 02:00 to 01:00 on 2026-11-01: 01:30 happens twice; the first is taken.
    assert.equal(utcOf("2026-11-01", "01:30", "America/New_York"), "2026-11-01T05:30:00.000Z");
    for (const [date, time, zone] of [["2026-02-30", "09:00", "UTC"], ["2026-11-03", "24:00", "UTC"], ["2026-11-03", "9:30", "UTC"], ["03/11/2026", "09:30", "UTC"], ["2026-11-03", "09:30", "Mars/Olympus"], ["2026-11-03", "09:30", ""]]) {
      assert.equal(utcOf(date, time, zone), null, `${date} ${time} ${zone}`);
    }
    // Shown back in the same timezone, it is what was typed.
    const at = wallClockToUtc({ date: "2026-11-03", time: "18:45" }, "Asia/Tokyo");
    assert.ok(at && localDateOf(at, "Asia/Tokyo") === "2026-11-03" && localTimeOf(at, "Asia/Tokyo") === "18:45");
    assert.deepEqual([addDays("2026-12-30", 3), addDays("2027-03-13", 1), isKnownTimeZone("Europe/Lisbon"), isKnownTimeZone("<script>")], ["2027-01-02", "2027-03-14", true, false]);
  });

  await check("schedule times: the schedule form sends the UTC instant wallClockToUtc made from the date, the time and the browser's own timezone, in its onSubmit; the server takes a time at most a minute ago and at most a year ahead", async () => {
    const form = withoutComments(await read("app/cofounder/studio/[draftId]/schedule-form.tsx"));
    assert.match(form, /onSubmit=\{submit\}/);
    assert.match(form, /const at = zone \? wallClockToUtc\(\{ date, time \}, zone\) : null;/);
    assert.match(form, /formData\.set\("scheduledFor", at\.toISOString\(\)\);/);
    assert.match(form, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
    assert.match(form, /startTransition\(\(\) => formAction\(formData\)\)/);
    const now = new Date("2026-11-03T12:00:00.000Z");
    assert.equal(checkScheduleTime(new Date("2026-11-03T11:59:01.000Z"), now), "ok");
    assert.equal(checkScheduleTime(new Date("2026-11-03T11:58:59.000Z"), now), "past");
    assert.equal(checkScheduleTime(new Date("2027-11-03T12:00:00.000Z"), now), "ok");
    assert.equal(checkScheduleTime(new Date("2027-11-03T12:00:01.000Z"), now), "too_far");
  });

  await check("publishing: a draft's status follows its posts (scheduled while one is on its way, failed while one failed or needs a check, published once all went out; with none left, approved while its approval holds, else a draft; a failed post whose account has the draft again since doesn't count), and a 429's wait is the platform's (30 s to a day) or 1, 2, 4, 8 minutes", async () => {
    // Each post as "account:status".
    const statusOf = (posts: string[], approvalHolds: boolean) =>
      draftStatusFromJobs(
        posts.map((post) => ({ connectionId: post.split(":")[0], status: post.split(":")[1] as PublishJobStatus })),
        approvalHolds,
      );
    assert.equal(statusOf(["a:queued", "b:published"], true), "scheduled");
    assert.equal(statusOf(["a:publishing"], true), "scheduled");
    assert.equal(statusOf(["a:published", "b:failed"], true), "failed");
    assert.equal(statusOf(["a:needs_attention", "b:canceled"], false), "failed");
    assert.equal(statusOf(["a:published", "b:canceled", "c:published"], true), "published");
    assert.equal(statusOf(["a:canceled"], true), "approved");
    assert.equal(statusOf(["a:canceled", "b:canceled"], false), "draft");
    // Scheduled again on the account whose post failed: that newer post decides.
    assert.equal(statusOf(["a:failed", "a:published"], true), "published");
    assert.equal(statusOf(["a:failed", "a:queued"], true), "scheduled");
    assert.equal(statusOf(["a:failed", "a:needs_attention"], true), "failed");
    assert.equal(statusOf(["a:failed", "a:failed", "a:canceled"], true), "failed");
    assert.equal(statusOf(["a:failed", "b:published"], true), "failed");
    assert.deepEqual([1, 2, 3, 4].map((attempt) => secondsUntilNextTry(attempt, undefined)), [60, 120, 240, 480]);
    assert.deepEqual([secondsUntilNextTry(1, 120), secondsUntilNextTry(1, 2), secondsUntilNextTry(1, 7 * 24 * 3600), secondsUntilNextTry(2, 90.2)], [120, 30, 24 * 3600, 91]);
  });

  await check("publishing: a post's address is kept only as https on its own platform's hosts, without a user name, a password or a port", async () => {
    assert.equal(readPostUrl(" https://www.linkedin.com/feed/update/urn:li:share:1/ ", "linkedin"), "https://www.linkedin.com/feed/update/urn:li:share:1/");
    assert.equal(readPostUrl("https://x.com/ansa/status/1790000000000000001", "x"), "https://x.com/ansa/status/1790000000000000001");
    assert.equal(readPostUrl("https://youtu.be/abc123", "youtube"), "https://youtu.be/abc123");
    for (const [address, platform] of [
      ["http://www.linkedin.com/feed/update/1", "linkedin"],
      ["https://www.linkedin.com.evil.test/feed", "linkedin"],
      ["https://x.com/ansa/status/1", "linkedin"],
      ["https://user:secret@www.facebook.com/1", "facebook"],
      ["https://www.facebook.com:8443/1", "facebook"],
      ["javascript:alert(1)", "x"],
      ["not an address", "x"],
      [`https://x.com/${"a".repeat(2_000)}`, "x"],
    ] as const) {
      assert.equal(readPostUrl(address, platform), null, address.slice(0, 60));
    }
  });

  await check("publishing: every code a post can fail, wait or need attention with (the queue's own and the platforms') reads as a sentence of its own, never as the code", async () => {
    for (const code of [...publishJobErrorCodes, ...publishErrorCodes]) {
      const words = describeJobError(code, "LinkedIn");
      assert.doesNotMatch(words, /[a-z]+_[a-z_]+|Something went wrong/, `${code}: ${words}`);
      assert.match(words, /\.$/, `${code}: ${words}`);
    }
    assert.equal(describeJobError("made_up_code", "LinkedIn"), "Something went wrong (made_up_code).");
  });
}
