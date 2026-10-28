import "server-only";
import { z } from "zod";
import { findPostForSimulation, saveSimulatedMetrics } from "@/db/post-metrics-simulation";
import { emptyMetricValues, METRIC_LABELS, METRIC_VALUE_MAX, metricColumns, platformOffers, type MetricColumn } from "@/lib/metric-definitions";
import { standInsAllowed } from "@/lib/social-mode";
import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/lib/social-platforms";

// `pnpm simulate:post-metrics <publish job id> views=120 reactions=8 ...`
// (step 42, development only, IMPLEMENTATION_PLAN decision 6): numbers for a
// development stand-in's published post, so the Analytics page and the
// performance review can be tried before any platform gives real ones.
// Never for a real account's post (its numbers come from its platform),
// never in production, and only numbers the post's platform has (X has no
// reach). Labeled "Simulated (development)" wherever they show.

export type SimulationResult = { ok: true; companyId: string; platform: SocialPlatform; values: Partial<Record<MetricColumn, number>> } | { ok: false; message: string };

type ReadArguments = { ok: true; values: Partial<Record<MetricColumn, number>> } | { ok: false; message: string };

const jobIdSchema = z.uuid().transform((id) => id.toLowerCase());
const countSchema = z.string().regex(/^\d{1,10}$/).transform(Number).pipe(z.number().int().max(METRIC_VALUE_MAX));
const ARGUMENT = /^([a-z_]+)=(.*)$/;

export const SIMULATE_USAGE = `Usage: pnpm simulate:post-metrics <publish job id> ${metricColumns.map((column) => `${column}=<number>`).join(" ")} (one or more)`;

// Saves simulated numbers for one stand-in post, or says why not.
export async function simulatePostMetrics(jobIdText: string, args: string[], nodeEnv: string | undefined = process.env.NODE_ENV): Promise<SimulationResult> {
  if (!standInsAllowed(nodeEnv)) {
    return refused("Simulated numbers are for development only: production reads real posts' numbers from their platforms.");
  }
  const jobId = jobIdSchema.safeParse(jobIdText);
  if (!jobId.success) {
    return refused(`"${jobIdText}" isn't a publish job id. ${SIMULATE_USAGE}`);
  }
  const read = readMetricArguments(args);
  if (!read.ok) {
    return read;
  }
  const post = await findPostForSimulation(jobId.data);
  if (!post) {
    return refused("No post has that id.");
  }
  if (!post.isStandIn) {
    return refused("That post went to a real account: its numbers come from its platform only, never from a simulation.");
  }
  if (post.status !== "published") {
    return refused("That post hasn't gone out, so it has no numbers yet.");
  }
  const platformLabel = SOCIAL_PLATFORM_LABELS[post.platform];
  const notOffered = metricColumns.filter((column) => read.values[column] !== undefined && !platformOffers(post.platform, column));
  if (notOffered.length > 0) {
    const names = notOffered.map((column) => METRIC_LABELS[column].toLowerCase()).join(" or ");
    return refused(`${platformLabel} gives no ${names}: leave ${notOffered.length === 1 ? "it" : "them"} out.`);
  }
  const saved = await saveSimulatedMetrics(post.companyId, jobId.data, { ...emptyMetricValues(), ...read.values });
  return saved ? { ok: true, companyId: post.companyId, platform: post.platform, values: read.values } : refused("That post changed meanwhile: try again.");
}

// "views=120 reactions=8" as numbers: known names, each once, whole numbers.
export function readMetricArguments(args: string[]): ReadArguments {
  const values: Partial<Record<MetricColumn, number>> = {};
  for (const argument of args) {
    const match = ARGUMENT.exec(argument);
    const column = match ? metricColumns.find((name) => name === match[1]) : undefined;
    if (!match || !column) {
      return refused(`"${argument}" isn't a number ansa keeps. ${SIMULATE_USAGE}`);
    }
    if (values[column] !== undefined) {
      return refused(`${column} is given twice.`);
    }
    const count = countSchema.safeParse(match[2]);
    if (!count.success) {
      return refused(`${column} must be a whole number from 0 to ${METRIC_VALUE_MAX}.`);
    }
    values[column] = count.data;
  }
  return Object.keys(values).length > 0 ? { ok: true, values } : refused(`Give at least one number. ${SIMULATE_USAGE}`);
}

function refused(message: string): { ok: false; message: string } {
  return { ok: false, message };
}
