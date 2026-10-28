"use client";

import { useActionState } from "react";
import { createAutopublishRuleAction } from "@/app/actions/publishing";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SOCIAL_PLATFORM_LABELS, socialPlatforms } from "@/lib/social-platforms";

// "New rule" (step 41, owners): a platform and one content pillar of the
// current marketing plan, or every pillar. It is made switched off: the
// rule's own button switches it on, after a confirm. A refusal keeps what
// was picked (each menu is keyed by its default, so React's reset after the
// action shows it again).
export function NewRuleForm({ pillars }: { pillars: string[] }) {
  const [errors, formAction, isPending] = useActionState(createAutopublishRuleAction, undefined);
  const shown = isPending ? undefined : errors;
  const platformDefault = errors?.values?.platform ?? "linkedin";
  const pillarDefault = errors?.values?.pillar ?? "";
  const pillarError = shown?.fieldErrors?.pillar?.[0];
  return (
    <form action={formAction} className="grid max-w-xl gap-3 rounded-lg border p-3">
      <p className="text-sm font-medium">New rule (switched off until you switch it on)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor="rule-platform">Platform</Label>
          <NativeSelect id="rule-platform" name="platform" defaultValue={platformDefault} key={platformDefault}>
            {socialPlatforms.map((platform) => (
              <option key={platform} value={platform}>
                {SOCIAL_PLATFORM_LABELS[platform]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="rule-pillar">Content pillar</Label>
          <NativeSelect
            id="rule-pillar"
            name="pillar"
            defaultValue={pillarDefault}
            key={pillarDefault}
            aria-invalid={pillarError ? true : undefined}
            aria-describedby={pillarError ? "rule-pillar-error" : undefined}
          >
            <option value="">Every pillar</option>
            {/* By position: a plan may give two pillars the same name. */}
            {pillars.map((pillar, index) => (
              <option key={index} value={pillar}>
                {pillar}
              </option>
            ))}
          </NativeSelect>
          {pillarError && (
            <p id="rule-pillar-error" role="alert" className="text-sm text-destructive">
              {pillarError}
            </p>
          )}
        </div>
      </div>
      {shown?.message && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {shown.message}
        </p>
      )}
      <Button type="submit" size="sm" className="justify-self-start" disabled={isPending}>
        {isPending ? "Making the rule..." : "Make the rule"}
      </Button>
    </form>
  );
}
