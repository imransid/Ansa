import { Suspense } from "react";
import type { Metadata } from "next";
import { isCoreOn } from "@/lib/core-api";
import { getTeamPageFromCore } from "@/lib/core-views/team";
import { requireSessionContext, type SessionContext } from "@/lib/session";
import { getTeamCategoriesForSession } from "@/services/categories";
import { getTeamForSession } from "@/services/team";
import { CategoriesSection } from "./categories-section";
import { InviteForm } from "./invite-form";
import { MembersTable } from "./members-table";
import { PendingInvitesTable } from "./pending-invites-table";
import { RemovedMembersTable } from "./removed-members-table";

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
  const session = await requireSessionContext("/team");
  // The new backend when it is switched on (lib/core-api.ts), else services/.
  const { team, teamCategories, currentUserId, isOwner } = isCoreOn() ? await getTeamPageFromCore() : await getTeamFromServices(session);

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Team</h1>
        {/* Hiding the owner buttons from members is only for a tidy page.
            services/team.ts refuses non-owners. */}
        <MembersTable
          members={team.members}
          currentUserId={currentUserId}
          canManageTeam={team.canManageTeam}
          teamCategories={teamCategories}
        />
      </section>
      {team.removedMembers.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">Removed</h2>
          <p className="text-sm text-muted-foreground">
            They can&apos;t log in any more. Their names stay on the tickets they worked on.
          </p>
          <RemovedMembersTable members={team.removedMembers} />
        </section>
      )}
      {/* Hiding this is only for a tidy page. services/categories.ts refuses non-owners. */}
      {isOwner && (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">Categories</h2>
          <p className="text-sm text-muted-foreground">
            A new ticket goes to whoever has the same customer&apos;s other open ticket; otherwise to whoever handles its
            category and has the fewest open tickets. When someone ticks a category, the open tickets waiting in it
            without anyone are handed out too.
          </p>
          <CategoriesSection categories={teamCategories.categories} />
        </section>
      )}
      {/* Hiding this is only for a tidy page. The real check is in
          services/invites.ts, which refuses non-owners. */}
      {team.canManageTeam && (
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

// The page as services/ read it before the new backend.
async function getTeamFromServices(session: SessionContext) {
  const [team, teamCategories] = await Promise.all([
    getTeamForSession(session),
    getTeamCategoriesForSession(session),
  ]);
  return { team, teamCategories, currentUserId: session.userId, isOwner: session.role === "owner" };
}
