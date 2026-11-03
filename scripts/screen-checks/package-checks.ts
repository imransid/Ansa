// Package, Billing and "Post for me" checks (the fixes of 2026-11-03), on
// the pure words of lib/packages.ts and on the code itself: the free trial's
// days are whole days rounded up, its end named as a date in the viewer's
// own time; call minutes run out by the seconds core counts; Billing in
// development is the demo's (nothing charged, no server setting named);
// "Posts for me" marks simulated numbers and refreshes itself while a post
// goes out.

import assert from "node:assert/strict";
import { callMinutesUsed, packageNotice, trialDaysLeft } from "@/lib/packages";
import type { AnsaPackage, PackageStatus } from "@/lib/types/packages";
import { check } from "./check";
import { read, withoutComments } from "./source-helpers";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const TRIAL: AnsaPackage = {
  key: "trial",
  name: "Free trial",
  priceUsd: 0,
  aiReplies: 150,
  callMinutes: 15,
  teamMembers: 3,
  orders: true,
  messenger: true,
  postForMe: "three_a_week",
};

function statusOf(trialEndsAt: Date, usage: PackageStatus["usage"] = { aiReplies: 0, callSeconds: 0 }): PackageStatus {
  return { package: TRIAL, trialEndsAt, usage };
}

export async function runPackageChecks() {
  await check("packages: the free trial's days are whole days rounded up (14 right after a 14-day signup, 1 on its last day), and its end is named as a date in the viewer's own time, never \"today\" or \"tomorrow\"", async () => {
    const now = new Date("2026-11-03T10:00:00Z");
    assert.equal(trialDaysLeft(new Date(now.getTime() + 14 * DAY_MS - 5_000), now), 14);
    assert.equal(trialDaysLeft(new Date(now.getTime() + 12 * HOUR_MS), now), 1);
    assert.equal(trialDaysLeft(new Date(now.getTime() + 30 * HOUR_MS), now), 2);
    assert.equal(trialDaysLeft(new Date(now.getTime() - 1_000), now), 0);
    const endsAt = new Date(now.getTime() + 30 * HOUR_MS);
    const notice = packageNotice(statusOf(endsAt), now);
    assert.equal(notice?.tone, "attention");
    assert.deepEqual(notice?.trialEnd, { at: endsAt, daysLeft: 2 });
    assert.equal(packageNotice(statusOf(new Date(now.getTime() + 10 * DAY_MS)), now)?.tone, "quiet");
    for (const file of ["lib/packages.ts", "app/dashboard/package-notice.tsx", "app/billing/usage-this-month.tsx"]) {
      assert.doesNotMatch(withoutComments(await read(file)), /today|tomorrow|one more day/, `${file} words the trial's end as a calendar day`);
    }
    assert.match(withoutComments(await read("app/dashboard/package-notice.tsx")), /<LocalDateTime iso=\{notice\.trialEnd\.at\.toISOString\(\)\} \/>/);
    assert.match(withoutComments(await read("app/billing/usage-this-month.tsx")), /<LocalDateTime iso=\{billing\.trialEndsAt\.toISOString\(\)\} \/>/);
  });

  await check("packages: call minutes run out by the seconds core counts (core/internal/packages CallTimeLeft), and the minutes used show rounded down", async () => {
    const now = new Date("2026-11-03T10:00:00Z");
    const endsAt = new Date(now.getTime() + 10 * DAY_MS);
    assert.equal(callMinutesUsed(statusOf(endsAt, { aiReplies: 0, callSeconds: 59 })), 0);
    assert.equal(callMinutesUsed(statusOf(endsAt, { aiReplies: 0, callSeconds: 15 * 60 - 1 })), 14);
    const almost = packageNotice(statusOf(endsAt, { aiReplies: 0, callSeconds: 15 * 60 - 1 }), now);
    assert.doesNotMatch(almost?.text ?? "", /No call minutes left/, "a second still left");
    const usedUp = packageNotice(statusOf(endsAt, { aiReplies: 0, callSeconds: 15 * 60 }), now);
    assert.match(usedUp?.text ?? "", /No call minutes left/);
  });

  await check("billing: in development the page says it is the demo's (nothing charged, no server setting named) and offers the demo's steps, each sent to core's development-only door", async () => {
    const panel = withoutComments(await read("app/billing/billing-panel.tsx")) + withoutComments(await read("app/billing/demo-controls.tsx"));
    assert.match(panel, /Demo payments: nothing is charged\./);
    assert.doesNotMatch(panel, /USE_STRIPE|development server/);
    for (const step of ["trial_ended", "ai_replies_used_up", "call_minutes_used_up", "payment_fixed", "cancel_at_period_end", "back_to_normal"]) {
      assert.match(panel, new RegExp(`step="${step}"`), `no "${step}" button`);
    }
    assert.match(withoutComments(await read("lib/core-views/billing.ts")), /callCore\("POST", "\/api\/v1\/billing\/demo"/);
  });

  await check("posts for me: a simulated post's numbers say so, as on every other page, and the page asks the server again while a post is due or going out", async () => {
    const list = withoutComments(await read("app/settings/posts/posted-list.tsx"));
    assert.match(list, /slot\.engagementSimulated && /);
    assert.match(list, /SIMULATED_LABEL/);
    assert.match(withoutComments(await read("app/settings/posts/page.tsx")), /<RefreshWhilePending isPending=\{page\.isBusy\} \/>/);
  });
}
