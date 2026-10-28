import type { MarketingPlan } from "@/lib/marketing-plan/plan-schema";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import { PlanSection } from "./plan-sections";

// What the plan says to do (step 37): its campaigns, and how often to post
// on each platform.

export function PlanCampaigns({ campaigns }: { campaigns: MarketingPlan["campaigns"] }) {
  return (
    <PlanSection id="plan-campaigns" title="Campaigns">
      <ul className="grid gap-3">
        {campaigns.map((campaign, index) => (
          <li key={index} className="grid gap-1 rounded-lg border p-3 text-sm wrap-anywhere">
            <p className="font-medium">{campaign.name}</p>
            <p>{campaign.objective}</p>
            <dl className="grid gap-0.5">
              <PlanDetail term="Pillar" value={campaign.pillar} />
              <PlanDetail term="Platforms" value={campaign.platforms.map((platform) => SOCIAL_PLATFORM_LABELS[platform]).join(", ")} />
              <PlanDetail term="When" value={campaign.timing} />
              <PlanDetail term="Call to action" value={campaign.call_to_action} />
            </dl>
          </li>
        ))}
      </ul>
    </PlanSection>
  );
}

export function PlanCadence({ cadence }: { cadence: MarketingPlan["cadence"] }) {
  return (
    <PlanSection id="plan-cadence" title="How often to post">
      <ul className="grid gap-2 text-sm wrap-anywhere">
        {cadence.map((entry) => (
          <li key={entry.platform} className="rounded-lg border p-3">
            <span className="font-medium">{SOCIAL_PLATFORM_LABELS[entry.platform]}:</span> {describePostsPerWeek(entry.posts_per_week)}
            {entry.formats.length > 0 && <span className="text-muted-foreground"> ({entry.formats.join(", ")})</span>}
          </li>
        ))}
      </ul>
    </PlanSection>
  );
}

function PlanDetail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="inline text-muted-foreground">{term}: </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}

// "2 posts a week", "1 post a week", "0.5 posts a week" (one every other week).
function describePostsPerWeek(postsPerWeek: number): string {
  const count = postsPerWeekFormat.format(postsPerWeek);
  return postsPerWeek === 1 ? "1 post a week" : `${count} posts a week`;
}

const postsPerWeekFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
