import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { AiEngineForm } from "@/components/restaurant-setup/ai-engine-form";
import { AnswerWhenForm } from "@/components/restaurant-setup/answer-when-form";
import { AssistantSettingsForm } from "@/components/restaurant-setup/assistant-settings-form";
import { AssistantTestBox } from "@/components/restaurant-setup/assistant-test-box";
import { HoursForm } from "@/components/restaurant-setup/hours-form";
import { RestaurantSummary } from "@/components/restaurant-setup/restaurant-summary";
import { requireSessionContext } from "@/lib/session";
import { AI_ENGINE_LABELS } from "@/lib/assistant/engine";
import { getEngineStateFromCore } from "@/lib/core-views/assistant";
import { getRestaurantProfileFromCore } from "@/lib/core-views/restaurant-setup";
import { timeZoneOptions } from "@/lib/locale-options";

export const metadata: Metadata = { title: "Assistant - ansa" };

// Settings → Assistant (step 45): how ansa answers customers. Owners change
// it; members read it.
export default function AssistantSettingsPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
          &larr; Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-muted-foreground">How and when ansa answers for you. It starts once Telegram (or another channel) is connected.</p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <AssistantSettings />
      </Suspense>
    </main>
  );
}

async function AssistantSettings() {
  await requireSessionContext("/settings/assistant");
  const [profile, engine] = await Promise.all([getRestaurantProfileFromCore(), getEngineStateFromCore()]);
  if (!profile.canManage) {
    return (
      <>
        <p className="text-sm text-muted-foreground">Only owners change these.</p>
        <RestaurantSummary profile={profile} show="assistant" />
        <p className="text-sm">
          AI engine: {AI_ENGINE_LABELS[engine.engine]}
          {engine.ready ? "" : " (not set up: customers get the holding reply)"}
        </p>
      </>
    );
  }
  const { settings } = profile;
  return (
    <>
      <section aria-labelledby="test-heading" className="grid gap-3 rounded-2xl border bg-card p-5">
        <h2 id="test-heading" className="text-lg font-semibold">
          Try your assistant
        </h2>
        <p className="text-sm text-muted-foreground">Write what someone might send, and see what ansa would answer. Nothing is sent to anyone.</p>
        <AssistantTestBox personal={profile.kind === "personal"} />
      </section>
      <section aria-labelledby="how-heading" className="grid gap-4">
        <h2 id="how-heading" className="text-lg font-semibold">
          How ansa answers
        </h2>
        <AssistantSettingsForm
          status={settings.status}
          replyMode={settings.replyMode}
          instructions={settings.instructions}
          holdingReply={settings.holdingReply}
          alertByEmail={settings.alertByEmail}
        />
      </section>
      <section aria-labelledby="when-heading" className="grid gap-4 border-t pt-6">
        <h2 id="when-heading" className="text-lg font-semibold">
          When ansa answers
        </h2>
        <AnswerWhenForm answerWhen={settings.answerWhen} />
        {/* The away times only matter in "Only when I'm away": a page that
            answers always doesn't show them. */}
        {settings.answerWhen === "when_away" && (
          <HoursForm
            place="settings"
            which="away"
            timeZone={settings.timeZone}
            openingHours={settings.awayHours}
            replyGraceMinutes={settings.replyGraceMinutes}
            timeZones={timeZoneOptions(settings.timeZone)}
          />
        )}
        <p className="text-sm text-muted-foreground">
          People you mark important on a conversation always come to you: ansa sends your holding reply and tells you at once.
        </p>
      </section>
      {/* Open while ansa has no AI that works: Home's "Getting started" links here then. */}
      <details open={!engine.ready} className="group border-t pt-6">
        <summary className="cursor-pointer text-lg font-semibold">
          <h2 id="engine-heading" className="inline">
            The AI that writes replies
          </h2>
          <span className="ml-2 text-sm font-normal text-muted-foreground">{engine.ready ? AI_ENGINE_LABELS[engine.engine] : "Not set up yet"}</span>
        </summary>
        <div className="mt-4">
          <AiEngineForm engine={engine.engine} keySource={engine.keySource} keyHint={engine.keyHint} claudeCodeAllowed={engine.claudeCodeAllowed} />
        </div>
      </details>
    </>
  );
}
