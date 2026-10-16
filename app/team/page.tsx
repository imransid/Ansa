import { Suspense } from "react";
import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { requireSessionContext } from "@/lib/session";
import { getDashboardSummary } from "@/services/dashboard";
import { getTeamForSession } from "@/services/team";
import { InviteForm } from "./invite-form";
import { MembersTable } from "./members-table";
import { PendingInvitesTable } from "./pending-invites-table";

export const metadata: Metadata = { title: "Team - ansa" };

export default function TeamPage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: anything that reads the session must sit
          inside <Suspense>, because it can only run at request time. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <TeamContent />
      </Suspense>
    </main>
  );
}

// Reads the session once and hands it to everything on the page.
async function TeamContent() {
  const session = await requireSessionContext();
  const [summary, team] = await Promise.all([
    getDashboardSummary(session),
    getTeamForSession(session),
  ]);

  return (
    <>
      <AppHeader summary={summary} />
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Team</h1>
        <MembersTable members={team.members} currentUserId={session.userId} />
      </section>
      {/* Hiding this is only for a tidy page. The real check is in
          services/invites.ts, which refuses non-owners. */}
      {team.canManageInvites && (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">Invite a teammate</h2>
          <InviteForm />
          <h2 className="text-lg font-semibold">Pending invites</h2>
          <PendingInvitesTable invites={team.pendingInvites} />
        </section>
      )}
    </>
  );
}
