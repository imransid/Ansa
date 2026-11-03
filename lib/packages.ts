import type { AnsaPackage, PackageStatus } from "@/lib/types/packages";

// What the screens say about a company's package (step 57): pure, so Home
// and Billing word it the same way.

const DAY_MS = 24 * 60 * 60 * 1000;

// Days left of the free trial, a part of a day counted as a whole one: 14
// right after a 14-day signup, 1 on its last day, 0 once it ended. WHY not
// calendar days: the trial ends 14 x 24 hours after signup, at the time of
// day it started, so the pages name that moment as a date in the viewer's
// own time instead of saying "today" or "tomorrow".
export function trialDaysLeft(trialEndsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}

// "1 day left", "14 days left".
export function daysLeftWords(days: number): string {
  return days === 1 ? "1 day left" : `${days} days left`;
}

// The month's minutes of calls, rounded down: a minute shows once it was used whole.
export function callMinutesUsed(status: PackageStatus): number {
  return Math.floor(status.usage.callSeconds / 60);
}

// The month's call time is used up, by the seconds core counts
// (core/internal/packages, CallTimeLeft), never by rounded minutes.
export function callTimeUsedUp(status: PackageStatus): boolean {
  return status.usage.callSeconds >= status.package.callMinutes * 60;
}

// Home's notice. trialEnd: the free trial's, which the page names before
// the text, as a date in the viewer's own time.
export type PackageNoticeText = {
  tone: "attention" | "quiet";
  text: string;
  trialEnd?: { at: Date; daysLeft: number };
};

// One notice for Home: "attention" when ansa stopped writing with the AI
// (or soon will), "quiet" for the free trial's days; null when all is well.
export function packageNotice(status: PackageStatus, now: Date): PackageNoticeText | null {
  const { package: pkg, usage } = status;
  if (pkg.key === "none") {
    return {
      tone: "attention",
      text: "Your free trial has ended. ansa still receives every message and sends your holding reply, but doesn't answer with the AI until you choose a package.",
    };
  }
  if (usage.aiReplies >= pkg.aiReplies) {
    return {
      tone: "attention",
      text: `ansa has used all ${pkg.aiReplies.toLocaleString("en")} AI replies of your package this month: it sends your holding reply until next month, or until you choose a bigger package.`,
    };
  }
  if (pkg.callMinutes > 0 && callTimeUsedUp(status)) {
    return { tone: "attention", text: "No call minutes left this month: ansa takes callers' messages without the AI." };
  }
  if (usage.aiReplies >= pkg.aiReplies * 0.8) {
    return { tone: "attention", text: `ansa has used ${usage.aiReplies.toLocaleString("en")} of ${pkg.aiReplies.toLocaleString("en")} AI replies this month.` };
  }
  if (pkg.key === "trial") {
    const days = trialDaysLeft(status.trialEndsAt, now);
    return {
      tone: days <= 3 ? "attention" : "quiet",
      text: "Choose a package to keep ansa answering.",
      trialEnd: { at: status.trialEndsAt, daysLeft: days },
    };
  }
  return null;
}

// What a package includes, line by line, for the Billing page ("app") and
// the website's Pricing page ("website", step 58). The website names no
// channel here: some aren't open to everyone yet, and its channel list
// (lib/website-channels.ts) says which.
export function packageLines(pkg: AnsaPackage, where: "app" | "website"): string[] {
  const lines = [
    `${pkg.aiReplies.toLocaleString("en")} AI replies a month`,
    `${pkg.callMinutes} minutes of calls a month`,
    pkg.teamMembers === 1 ? "1 person" : `Up to ${pkg.teamMembers} team members`,
    where === "website" ? websiteChannelLine(pkg) : appChannelLine(pkg),
  ];
  if (pkg.orders) {
    lines.push("Orders with totals worked out by ansa");
  }
  if (pkg.postForMe === "daily") {
    lines.push("\"Post for me\" every day");
  } else if (pkg.postForMe === "three_a_week") {
    lines.push("\"Post for me\" up to 3 times a week");
  }
  return lines;
}

function appChannelLine(pkg: AnsaPackage): string {
  return pkg.messenger ? "WhatsApp, Telegram, Messenger and email" : "WhatsApp, Telegram and email";
}

function websiteChannelLine(pkg: AnsaPackage): string {
  return pkg.messenger ? "Every channel ansa answers on" : "Every channel but Facebook Messenger";
}
