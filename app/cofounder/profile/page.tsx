import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { requireSessionContext } from "@/lib/session";
import { getBusinessProfileForSession } from "@/services/business-profile";
import { listArticlesForSuggestionsForSession } from "@/services/fact-suggestions";
import { ProfileCompletionSummary } from "../profile-completion";
import { SuggestFromKnowledge } from "./suggest-from-knowledge";
import { TopicCard } from "./topic-card";

export const metadata: Metadata = { title: "Business profile - Co-Founder - ansa" };

// "Suggest facts from knowledge" asks Claude inside this page's server action
// (up to 2 tries of 45 s): the host's default time limit can be as short as
// 10 seconds.
export const maxDuration = 300;

export default function ProfilePage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <ProfileContent />
      </Suspense>
    </main>
  );
}

// The company's business profile (step 36): every topic, grouped, with what
// is confirmed, what the AI proposed, and what is still missing. Owners
// confirm, edit and dismiss; members read.
async function ProfileContent() {
  const session = await requireSessionContext("/cofounder/profile");
  // Hiding the buttons is only for a tidy page: the services and /db refuse members.
  const isOwner = canManageBusinessProfile(session.role);
  const [profile, articles] = await Promise.all([
    getBusinessProfileForSession(session),
    isOwner ? listArticlesForSuggestionsForSession(session) : [],
  ]);

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Business profile</h1>
        <p className="text-sm text-muted-foreground">
          What the Co-Founder knows about your business, topic by topic. Key facts are the ones it needs before it can
          help with your marketing; &ldquo;none&rdquo; or &ldquo;doesn&apos;t apply&rdquo; is a fine answer to many of them.
          Facts are your company&apos;s own information and are stored as plain text, like knowledge articles. The{" "}
          <Link href="/cofounder/interview" className="underline">
            interview
          </Link>{" "}
          proposes facts too.
        </p>
        <ProfileCompletionSummary completion={profile.completion} />
        {!isOwner && <p className="text-sm text-muted-foreground">Only owners confirm, edit or dismiss facts.</p>}
      </section>

      {isOwner && <SuggestFromKnowledge articles={articles} />}

      {profile.groups.map((group) => (
        <section key={group.group} className="grid gap-3" aria-labelledby={`group-${group.group}`}>
          <h2 id={`group-${group.group}`} className="text-lg font-semibold">
            {group.label}
          </h2>
          <ul className="grid gap-3">
            {group.topics.map((topic) => (
              <TopicCard key={topic.topic} topic={topic} isOwner={isOwner} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
