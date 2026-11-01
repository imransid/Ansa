import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { TeamCategories } from "@/lib/types/categories";
import type { Team } from "@/lib/types/team";
import type { CompanyUser } from "@/lib/types/users";

// The Team page, its invites and categories (and a request's category on
// the ticket page) through the new backend (core's /api/v1/team and
// /api/v1/requests), in the shapes the pages and their actions already read.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type UserRole = CompanyUser["role"];

// An id from a form as one segment of core's address.
function segment(value: unknown): string {
  return encodeURIComponent(text(value));
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

type CorePerson = { id: string; name: string; email: string; role: UserRole; confirmed: boolean; removedAt: string | null; categoryIds: string[] };

type CoreTeam = {
  team: {
    members: CorePerson[];
    removed: CorePerson[];
    invites: { id: string; email: string; role: UserRole; expiresAt: string }[];
    categories: TeamCategories["categories"];
  };
  canManage: boolean;
  me: string;
};

function toCompanyUser(person: CorePerson): CompanyUser {
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    emailConfirmed: person.confirmed,
    removedAt: person.removedAt ? new Date(person.removedAt) : null,
  };
}

// Everyone on the team, the removed, pending invites (owners only) and the
// categories with who handles which (core lists only active ones per person).
export async function getTeamPageFromCore(): Promise<{ team: Team; teamCategories: TeamCategories; currentUserId: string; isOwner: boolean }> {
  const answer = await callCore<CoreTeam>("GET", "/api/v1/team");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { team, canManage, me } = answer.data;
  return {
    team: {
      members: team.members.map(toCompanyUser),
      removedMembers: team.removed.map(toCompanyUser),
      canManageTeam: canManage,
      pendingInvites: team.invites.map((invite) => ({ ...invite, expiresAt: new Date(invite.expiresAt) })),
    },
    teamCategories: {
      categories: team.categories,
      links: team.members.flatMap((person) => person.categoryIds.map((categoryId) => ({ userId: person.id, categoryId }))),
    },
    currentUserId: me,
    isOwner: canManage,
  };
}

// An invite link for one address and role ("#<token>": the token never reaches a server).
export async function createInviteThroughCore(input: { email: unknown; role: unknown }): Promise<{ ok: true; inviteLink: string } | { ok: false; errors: FormErrors }> {
  const answer = await callCore<{ link: string }>("POST", "/api/v1/team/invites", { email: text(input.email), role: text(input.role) });
  return answer.ok ? { ok: true, inviteLink: answer.data.link } : { ok: false, errors: toFormErrors(answer) };
}

export async function revokeInviteThroughCore(inviteId: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `/api/v1/team/invites/${segment(inviteId)}/revoke`));
}

export async function removeTeammateThroughCore(userId: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `/api/v1/team/people/${segment(userId)}/remove`));
}

export async function changeTeammateRoleThroughCore(userId: unknown, role: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `/api/v1/team/people/${segment(userId)}/role`, { role: text(role) }));
}

// The categories one person handles (the boxes ticked: every one replaces the list).
export async function setUserCategoriesThroughCore(userId: unknown, categoryIds: unknown[]): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `/api/v1/team/people/${segment(userId)}/categories`, { categoryIds: categoryIds.map(text) }));
}

export async function createCategoryThroughCore(name: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/team/categories", { name: text(name) }));
}

export async function renameCategoryThroughCore(categoryId: unknown, name: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `/api/v1/team/categories/${segment(categoryId)}/rename`, { name: text(name) }));
}

// archived: the form's "true" (archive) or "false" (restore).
export async function setCategoryArchivedThroughCore(categoryId: unknown, archived: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `/api/v1/team/categories/${segment(categoryId)}/archive`, { archived: text(archived) === "true" }));
}

// A request's category by name ("" = none); an open, unassigned request is routed.
export async function setTicketCategoryThroughCore(ticketId: unknown, category: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `/api/v1/requests/${segment(ticketId)}/category`, { category: text(category) }));
}
