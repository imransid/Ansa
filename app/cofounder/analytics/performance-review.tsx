import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { SIMULATED_LABEL } from "@/lib/analytics/kinds";
import type { ShownReview } from "@/services/analytics-page";

// The newest performance review (step 42): what the AI found, each finding
// with the numbers it cites (every one checked against what it was given),
// what it recommends, and what the numbers can't tell.
export function PerformanceReviewView({ review }: { review: ShownReview }) {
  const madeBy = review.madeByName ?? "a former teammate";
  return (
    <div className="grid gap-4 text-sm">
      <p className="text-muted-foreground">
        Made <LocalDateTime iso={review.madeAt.toISOString()} /> by {madeBy}, from the posts that went out from{" "}
        <LocalDateTime iso={review.periodStart.toISOString()} dateOnly /> to <LocalDateTime iso={review.periodEnd.toISOString()} dateOnly />
        {review.readable && ` (${review.postCount} with numbers)`}.
        {review.simulated && (
          <Badge variant="outline" className="ml-2">
            {SIMULATED_LABEL}
          </Badge>
        )}
      </p>
      {review.readable ? <ReviewContent review={review} /> : <p>This review was saved by another version of ansa and can&apos;t be shown here.</p>}
    </div>
  );
}

function ReviewContent({ review }: { review: ShownReview }) {
  return (
    <>
      <section className="grid gap-2" aria-labelledby="review-findings">
        <h3 id="review-findings" className="font-medium">
          Findings
        </h3>
        <ol className="grid list-decimal gap-3 pl-5">
          {review.findings.map((finding, index) => (
            <li key={index} className="grid gap-1">
              <p className="wrap-anywhere">{finding.text}</p>
              <ul className="grid gap-0.5 text-muted-foreground">
                {finding.evidence.map((evidence, evidenceIndex) => (
                  <li key={evidenceIndex} className="wrap-anywhere">
                    {evidence.source}: {evidence.metric} <span className="font-medium text-foreground tabular-nums">{evidence.value}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
      <section className="grid gap-2" aria-labelledby="review-recommendations">
        <h3 id="review-recommendations" className="font-medium">
          Recommendations
        </h3>
        {review.recommendations.length === 0 ? (
          <p className="text-muted-foreground">None this time.</p>
        ) : (
          <ul className="grid list-disc gap-2 pl-5">
            {review.recommendations.map((recommendation, index) => (
              <li key={index} className="wrap-anywhere">
                {recommendation.text}{" "}
                <span className="text-muted-foreground">
                  (from finding{recommendation.basedOn.length === 1 ? "" : "s"} {recommendation.basedOn.join(", ")})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {review.limits.length > 0 && (
        <section className="grid gap-2" aria-labelledby="review-limits">
          <h3 id="review-limits" className="font-medium">
            What these numbers can&apos;t tell
          </h3>
          <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">
            {review.limits.map((limit, index) => (
              <li key={index} className="wrap-anywhere">
                {limit}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
