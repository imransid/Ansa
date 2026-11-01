import Link from "next/link";
import { finishSetupAction } from "@/app/actions/restaurant-setup";
import { ActionButtonForm } from "@/components/restaurant-setup/action-button-form";
import { RestaurantSummary } from "@/components/restaurant-setup/restaurant-summary";
import { buttonVariants } from "@/components/ui/button";
import type { RestaurantProfile } from "@/services/restaurant-setup";

// Setup's last step: everything the owner entered, read back, and the button
// that finishes setup and opens Home.
export function ReadyStep({ profile, backHref }: { profile: RestaurantProfile; backHref: string }) {
  return (
    <div className="grid gap-6">
      <RestaurantSummary profile={profile} show="business" />
      <p className="text-sm text-muted-foreground">
        {profile.kind === "personal"
          ? "ansa answers for you once Telegram is connected, and Home shows you what you missed while you were away."
          : "ansa replies on its own once Telegram or Messenger is connected. Next, you'll add your menu."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref} className={buttonVariants({ variant: "ghost" })}>
          Back
        </Link>
        <ActionButtonForm action={finishSetupAction} label="Open ansa" />
      </div>
    </div>
  );
}
