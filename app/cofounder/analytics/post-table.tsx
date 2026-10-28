import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/analytics/format";
import { SIMULATED_LABEL } from "@/lib/analytics/kinds";
import { describeLatestTryProblem, describeWhyNoNumbers } from "@/lib/analytics/post-notes";
import { metricColumns, metricLabel } from "@/lib/metric-definitions";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import type { ShownPost } from "@/services/analytics-page";

// The period's posts (step 42), newest first: the draft's topic, where it
// went and when, and its latest numbers with when they were read, or why
// there are none. WHY a fixed layout: the table is as wide as the page,
// whatever the topics say; narrow screens put the date under the topic.
export function PostTable({ posts }: { posts: ShownPost[] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead>Post</TableHead>
          <TableHead className="hidden w-44 md:table-cell">Went out</TableHead>
          <TableHead className="w-[45%] md:w-[40%]">Latest numbers</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((post) => {
          const platformLabel = SOCIAL_PLATFORM_LABELS[post.platform];
          return (
            <TableRow key={post.jobId} className="align-top">
              <TableCell className="whitespace-normal">
                <Link href={`/cofounder/studio/${post.draftId}`} className="font-medium wrap-anywhere hover:underline">
                  {post.topic}
                </Link>
                <p className="text-muted-foreground wrap-anywhere">
                  {post.accountName ? `${platformLabel} (${post.accountName})` : platformLabel}
                  {post.accountIsStandIn && (
                    <Badge variant="outline" className="ml-2">
                      Development stand-in
                    </Badge>
                  )}
                </p>
                <p className="text-muted-foreground md:hidden">
                  <LocalDateTime iso={post.publishedAt.toISOString()} />
                </p>
              </TableCell>
              <TableCell className="hidden whitespace-normal md:table-cell">
                <LocalDateTime iso={post.publishedAt.toISOString()} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <PostNumbers post={post} platformLabel={platformLabel} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// The numbers of the newest snapshot, only the ones it has, and when it was
// read; or why there is none. A later try that failed is said too, while
// the post's numbers are still read.
function PostNumbers({ post, platformLabel }: { post: ShownPost; platformLabel: string }) {
  const latest = post.latest;
  const latestTryProblem = describeLatestTryProblem(post, platformLabel);
  return (
    <div className="grid gap-1">
      {latest ? (
        <>
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {metricColumns.flatMap((column) => {
              const value = latest.values[column];
              return value === null ? [] : [<li key={column}>{`${metricLabel(post.platform, column)} ${formatNumber(value)}`}</li>];
            })}
          </ul>
          <p className="text-muted-foreground">
            Read <LocalDateTime iso={latest.collectedAt.toISOString()} dateOnly />
            {/* Text, not a badge: a badge never wraps, and this column is narrow on a phone. */}
            {latest.source === "dev_simulated" && <span className="font-medium text-foreground">{` (${SIMULATED_LABEL})`}</span>}
          </p>
          {latestTryProblem && <p className="text-muted-foreground">Last try: {latestTryProblem}</p>}
        </>
      ) : (
        <p className="text-muted-foreground">{describeWhyNoNumbers(post, platformLabel)}</p>
      )}
      {post.accountIsStandIn && (
        <p className="text-xs text-muted-foreground wrap-anywhere">
          Development: <code>pnpm simulate:post-metrics {post.jobId} views=120 reactions=8</code>
        </p>
      )}
    </div>
  );
}
