import { METRIC_DEFINITIONS, METRIC_LABELS, metricColumns, type MetricColumn } from "@/lib/metric-definitions";
import { SOCIAL_PLATFORM_LABELS, socialPlatforms, type SocialPlatform } from "@/lib/social-platforms";

// What each number means on each platform (step 42, lib/metric-definitions.ts):
// the platform's own word and field, one line saying what it counts, and
// whether ansa reads it, or why not. Folded per platform.
export function MetricDefinitionsList() {
  return (
    <div className="grid gap-2">
      {socialPlatforms.map((platform) => (
        <details key={platform} className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{SOCIAL_PLATFORM_LABELS[platform]}</summary>
          <dl className="mt-3 grid gap-3">
            {metricColumns.map((column) => (
              <Definition key={column} platform={platform} column={column} />
            ))}
          </dl>
        </details>
      ))}
    </div>
  );
}

function Definition({ platform, column }: { platform: SocialPlatform; column: MetricColumn }) {
  const definition = METRIC_DEFINITIONS[platform][column];
  const ourLabel = METRIC_LABELS[column];
  if (definition.status === "not_offered") {
    return (
      <div className="grid gap-0.5">
        <dt className="font-medium">{ourLabel}</dt>
        <dd className="text-muted-foreground">
          Not available on {SOCIAL_PLATFORM_LABELS[platform]}: {definition.definition}
        </dd>
      </div>
    );
  }
  const title = definition.label === ourLabel ? ourLabel : `${definition.label} (${ourLabel})`;
  return (
    <div className="grid gap-0.5">
      <dt className="font-medium">{title}</dt>
      <dd>
        {definition.definition}{" "}
        <span className="text-muted-foreground">
          From <code className="wrap-anywhere">{definition.field}</code>.{" "}
          {definition.status === "collected"
            ? "ansa reads it about once a day."
            : `Not read yet: ${SOCIAL_PLATFORM_LABELS[platform]} gives it only with ${definition.permission}, which ansa doesn't ask for.`}
        </span>
      </dd>
    </div>
  );
}
