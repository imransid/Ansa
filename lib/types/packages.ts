// ansa's packages as core sends them (core/internal/packages, step 57: the
// one file where names, prices and limits live).

export type PackageKey = "trial" | "personal" | "business" | "pro" | "none";

export type AnsaPackage = {
  key: PackageKey;
  name: string;
  priceUsd: number;
  // What one calendar month includes.
  aiReplies: number;
  callMinutes: number;
  teamMembers: number;
  orders: boolean;
  messenger: boolean;
  postForMe: "none" | "three_a_week" | "daily";
};

// What the company used this month.
export type PackageUsage = { aiReplies: number; callSeconds: number };

// The company's package now, when its free trial ends, and this month's use.
export type PackageStatus = { package: AnsaPackage; trialEndsAt: Date; usage: PackageUsage };
