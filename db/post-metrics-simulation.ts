import "server-only";
import { and, eq } from "drizzle-orm";
import type { PostMetricValues } from "@/lib/metric-definitions";
import type { PublishJobStatus } from "@/lib/publishing/kinds";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db } from "./client";
import { snapshotRow } from "./post-metrics";
import { postMetrics, publishJobs, socialConnections } from "./schema";

// `pnpm simulate:post-metrics` (step 42, development only): numbers for a
// development stand-in's post, saved as a dev_simulated snapshot, labeled
// "Simulated (development)" wherever they show. Real posts never get any
// this way: their numbers come from their platform. The command refuses to
// run outside a local database (scripts/simulate-post-metrics.ts), and the
// service refuses production (services/post-metrics-simulation.ts).

export type PostForSimulation = { companyId: string; status: PublishJobStatus; platform: SocialPlatform; isStandIn: boolean };

// The post the command names by its id, with its company. Not
// company-scoped on purpose: a development command run by hand has no
// session; it reads one row by an id nobody can guess, and writes only
// through the company-scoped save below.
export async function findPostForSimulation(jobId: string): Promise<PostForSimulation | undefined> {
  const [post] = await db
    .select({ companyId: publishJobs.companyId, status: publishJobs.status, platform: socialConnections.platform, isStandIn: socialConnections.isStandIn })
    .from(publishJobs)
    .innerJoin(socialConnections, and(eq(socialConnections.companyId, publishJobs.companyId), eq(socialConnections.id, publishJobs.connectionId)))
    .where(eq(publishJobs.id, jobId));
  return post;
}

// Saves simulated numbers for one company's published post of a stand-in
// account, the post locked while it is read. False: the company has no
// such post (not published, or a real account's).
export async function saveSimulatedMetrics(companyId: string, jobId: string, values: PostMetricValues): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [post] = await tx
      .select({ id: publishJobs.id })
      .from(publishJobs)
      .innerJoin(socialConnections, and(eq(socialConnections.companyId, publishJobs.companyId), eq(socialConnections.id, publishJobs.connectionId)))
      .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId), eq(publishJobs.status, "published"), eq(socialConnections.isStandIn, true)))
      .for("share", { of: publishJobs });
    if (!post) {
      return false;
    }
    await tx.insert(postMetrics).values(snapshotRow(companyId, jobId, values, "dev_simulated"));
    return true;
  });
}
