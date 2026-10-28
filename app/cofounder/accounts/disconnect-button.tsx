"use client";

import { disconnectSocialAccountAction } from "@/app/actions/social-accounts";
import { ConfirmButton } from "@/components/confirm-button";
import { REVOKES_ON_REQUEST, SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/lib/social-platforms";

// Disconnect asks first, as every button that ends something does.
export function DisconnectButton({ connectionId, displayName, platform, isStandIn }: { connectionId: string; displayName: string; platform: SocialPlatform; isStandIn: boolean }) {
  const label = SOCIAL_PLATFORM_LABELS[platform];
  return (
    <ConfirmButton
      action={disconnectSocialAccountAction}
      fields={{ connectionId }}
      label="Disconnect"
      accessibleLabel={`Disconnect ${displayName}`}
      question={`Disconnect ${displayName}? ansa deletes the access it was given at once and can't post to it any more. Posts already published stay on ${label}.${whatElseHappens(platform, isStandIn)}`}
      confirmLabel="Yes, disconnect"
      pendingLabel="Disconnecting..."
    />
  );
}

// What the platform's side of a disconnect is. X and Google give one
// access per account to ansa's one app, so it is taken back only once no
// other company using ansa has the account connected.
function whatElseHappens(platform: SocialPlatform, isStandIn: boolean): string {
  const label = SOCIAL_PLATFORM_LABELS[platform];
  if (isStandIn) {
    return "";
  }
  if (REVOKES_ON_REQUEST.includes(platform)) {
    return ` ansa also asks ${label} to take its access back, unless another company using ansa has connected it too.`;
  }
  return ` To remove ansa from ${label} too, do it in your ${label} settings.`;
}
