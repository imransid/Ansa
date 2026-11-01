import "server-only";
import { callCore } from "@/lib/core-api";
import type { ActivityListItem, AutopublishRuleListItem, PublishJobListItem, QueuePage } from "@/services/publishing-pages";

// The Co-Founder's publishing queue through the new backend (core's GET
// /api/v1/cofounder/queue), in the shapes the page already reads. Its
// buttons, a draft's "Schedule" and "Plan the next 2 weeks" are
// lib/core-views/publishing.ts.

// A post as core lists it (the queue, a draft's page, the Analytics page's
// problems): its times as ISO strings.
export type CorePublishJob = Omit<PublishJobListItem, "scheduledFor" | "runAfter" | "publishedAt" | "updatedAt"> & {
  scheduledFor: string;
  runAfter: string;
  publishedAt: string | null;
  updatedAt: string;
};

// One line of the activity log as core lists it.
export type CoreActivityEntry = Omit<ActivityListItem, "createdAt"> & { createdAt: string };

type CoreRule = Omit<AutopublishRuleListItem, "createdAt" | "enabledAt"> & { createdAt: string; enabledAt: string | null };

type CoreQueuePage = {
  counts: QueuePage["counts"];
  waiting: CorePublishJob[];
  needsAttention: CorePublishJob[];
  failed: CorePublishJob[];
  published: CorePublishJob[];
  canceled: CorePublishJob[];
  rules: CoreRule[];
  pillars: string[];
  activity: CoreActivityEntry[];
  canManage: boolean;
  isBusy: boolean;
};

function dateOrNull(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

export function toPublishJobListItem(job: CorePublishJob): PublishJobListItem {
  return {
    ...job,
    scheduledFor: new Date(job.scheduledFor),
    runAfter: new Date(job.runAfter),
    publishedAt: dateOrNull(job.publishedAt),
    updatedAt: new Date(job.updatedAt),
  };
}

export function toActivityListItem(entry: CoreActivityEntry): ActivityListItem {
  return { ...entry, createdAt: new Date(entry.createdAt) };
}

function toRule(rule: CoreRule): AutopublishRuleListItem {
  return { ...rule, createdAt: new Date(rule.createdAt), enabledAt: dateOrNull(rule.enabledAt) };
}

// The company's posts by status with their counts, its auto-publish rules,
// the current plan's content pillars (for a new rule) and the newest
// activity; whether this person acts (owners) and whether a post is going
// out (the page refreshes itself).
export async function getQueuePageFromCore(): Promise<QueuePage> {
  const answer = await callCore<CoreQueuePage>("GET", "/api/v1/cofounder/queue");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const page = answer.data;
  return {
    counts: page.counts,
    waiting: page.waiting.map(toPublishJobListItem),
    needsAttention: page.needsAttention.map(toPublishJobListItem),
    failed: page.failed.map(toPublishJobListItem),
    published: page.published.map(toPublishJobListItem),
    canceled: page.canceled.map(toPublishJobListItem),
    rules: page.rules.map(toRule),
    pillars: page.pillars,
    activity: page.activity.map(toActivityListItem),
    canManage: page.canManage,
    isBusy: page.isBusy,
  };
}
