import { describeDay, WEEKDAYS } from "@/lib/opening-hours";
import { ANSWER_WHEN_LABELS } from "@/lib/assistant/availability";
import { BUSINESS_TYPE_LABELS, describeReplyMode } from "@/lib/restaurant-setup";
import type { RestaurantProfile } from "@/services/restaurant-setup";

// What ansa knows about the restaurant, read only: the setup's last step, and
// the Settings pages for members (only owners change it).
export function RestaurantSummary({ profile, show }: { profile: RestaurantProfile; show: "business" | "assistant" }) {
  const { settings } = profile;
  const rows: [string, string][] =
    show === "business" && profile.kind === "personal"
      ? personalRows(profile)
      : show === "business"
      ? [
          ["Business", `${profile.companyName}${profile.businessType ? `, ${BUSINESS_TYPE_LABELS[profile.businessType].toLowerCase()}` : ""}`],
          ["What you offer", profile.description || "Not given yet"],
          ["Where", profile.address || "Not given yet"],
          ["Phone for customers", settings.publicPhone ?? "None"],
          ...WEEKDAYS.map(({ key, label }): [string, string] => [label, settings.openingHours ? describeDay(settings.openingHours[key]) : "Not set yet"]),
          ["Time zone", settings.timeZone?.replaceAll("_", " ") ?? "Not set yet"],
          ["Orders", describeOrders(profile)],
          ["Payment", settings.paymentNote || "Not given"],
          ["Currency", settings.currency ?? "Not set yet"],
        ]
      : [
          ["Replies", describeReplyMode(settings.status, settings.replyMode)],
          ["When ansa answers", ANSWER_WHEN_LABELS[settings.answerWhen]],
          ["When a person takes over", settings.holdingReply],
          ["Instructions", settings.instructions || "None"],
          ["Email alerts", settings.alertByEmail ? "On" : "Off"],
        ];
  return (
    <dl className="divide-y border-y text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="whitespace-pre-line">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A person (step 50): who they are, and when ansa answers for them.
function personalRows(profile: RestaurantProfile): [string, string][] {
  const { settings } = profile;
  return [
    ["Name", profile.companyName],
    ["What you do", profile.description || "Not given"],
    ...WEEKDAYS.map(({ key, label }): [string, string] => [`Away on ${label}`, settings.awayHours ? describeDay(settings.awayHours[key]) : "Not set yet"]),
    ["Time zone", settings.timeZone?.replaceAll("_", " ") ?? "Not set yet"],
    ["At other times", settings.replyGraceMinutes ? `ansa answers if you haven't within ${settings.replyGraceMinutes} minutes` : "You answer yourself"],
  ];
}

function describeOrders({ settings }: RestaurantProfile): string {
  if (!settings.takesOrders) {
    return "Not taken through ansa";
  }
  const ways = [settings.delivery ? "delivery" : "", settings.pickup ? "pickup" : ""].filter(Boolean);
  return ways.length > 0 ? `Taken, for ${ways.join(" and ")}` : "Taken";
}
