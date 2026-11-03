import type { AnsaPackage, PackageStatus } from "@/lib/types/packages";

// What the screens say about a company's package (step 57): pure, so Home
// and Billing word it the same way.

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days left of the free trial (0 on its last day).
export function trialDaysLeft(trialEndsAt: Date, now: Date): number {
  return Math.max(0, Math.floor((trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}

export function callMinutesUsed(status: PackageStatus): number {
  return Math.ceil(status.usage.callSeconds / 60);
}

// One notice for Home: "attention" when ansa stopped writing with the AI
// (or soon will), "quiet" for the free trial's days; null when all is well.
export function packageNotice(status: PackageStatus, now: Date): { tone: "attention" | "quiet"; text: string } | null {
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
  if (callMinutesUsed(status) >= pkg.callMinutes && pkg.callMinutes > 0) {
    return { tone: "attention", text: "No call minutes left this month: ansa takes callers' messages without the AI." };
  }
  if (usage.aiReplies >= pkg.aiReplies * 0.8) {
    return { tone: "attention", text: `ansa has used ${usage.aiReplies.toLocaleString("en")} of ${pkg.aiReplies.toLocaleString("en")} AI replies this month.` };
  }
  if (pkg.key === "trial") {
    const days = trialDaysLeft(status.trialEndsAt, now);
    const when = days === 0 ? "ends today" : days === 1 ? "ends tomorrow" : `has ${days} days left`;
    return { tone: days <= 3 ? "attention" : "quiet", text: `Your free trial ${when}. Choose a package to keep ansa answering.` };
  }
  return null;
}

// What a package includes, line by line, for the Billing page.
export function packageLines(pkg: AnsaPackage): string[] {
  const lines = [
    `${pkg.aiReplies.toLocaleString("en")} AI replies a month`,
    `${pkg.callMinutes} minutes of calls a month`,
    pkg.teamMembers === 1 ? "1 person" : `Up to ${pkg.teamMembers} team members`,
    pkg.messenger ? "WhatsApp, Telegram, Messenger and email" : "WhatsApp, Telegram and email",
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
