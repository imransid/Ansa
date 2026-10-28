import { LocalDateTime } from "@/components/local-date-time";
import type { MetricsActivity } from "@/services/analytics-page";

// When the company's post numbers were last read (step 42): from a
// platform, the last try at all, and in development the last simulation.
export function CollectionStatus({ activity }: { activity: MetricsActivity }) {
  return (
    <ul className="grid gap-1 text-sm text-muted-foreground">
      <li>
        Numbers last read from a platform:{" "}
        {activity.lastCollectedAt ? <LocalDateTime iso={activity.lastCollectedAt.toISOString()} /> : "never yet"}.
        {activity.lastAttemptAt && (
          <>
            {" "}
            Last try: <LocalDateTime iso={activity.lastAttemptAt.toISOString()} />.
          </>
        )}
      </li>
      {activity.lastSimulatedAt && (
        <li>
          Numbers last simulated (development): <LocalDateTime iso={activity.lastSimulatedAt.toISOString()} />.
        </li>
      )}
    </ul>
  );
}
