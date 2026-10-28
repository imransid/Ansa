import "server-only";
import { getActiveCategories } from "@/db/categories";
import { getCompanyById } from "@/db/companies";
import type { UserRole } from "@/db/schema";
import { companyHasTickets } from "@/db/tickets";
import { getUserCategoryLinks } from "@/db/user-categories";
import type { SessionContext } from "@/lib/session";
import { buildSetupChecklist, getSetupForSession } from "./setup";

export type DashboardSummary = {
  userName: string;
  email: string;
  role: UserRole;
  companyName: string;
};

// What the dashboard points people to while their part of the setup isn't
// done (step 32): a new owner may never find the Setup page, and an expert
// who never ticks a category never gets a ticket from routing.
export type FirstRunHints = {
  // Owners only, and only while the company has no ticket yet: how many Setup
  // checklist steps are still "to do". Null otherwise: members can't change
  // the setup, and see countSetupStepsLeft for why it stops at the first ticket.
  setupStepsLeft: number | null;
  // The company has categories, but this person handles none of them, so
  // routing by category never gives them a ticket.
  handlesNoCategory: boolean;
};

// Gathers what the page header shows for the logged-in user.
export async function getDashboardSummary(
  session: SessionContext,
): Promise<DashboardSummary> {
  const company = await getCompanyById(session.companyId);
  if (!company) {
    throw new Error("The session's company does not exist");
  }

  return {
    userName: session.name,
    email: session.email,
    role: session.role,
    companyName: company.name,
  };
}

// Says what the dashboard should point the logged-in user to (see FirstRunHints).
export async function getFirstRunHintsForSession(session: SessionContext): Promise<FirstRunHints> {
  const [setupStepsLeft, handlesNoCategory] = await Promise.all([
    countSetupStepsLeft(session),
    handlesNoActiveCategory(session),
  ]);
  return { setupStepsLeft, handlesNoCategory };
}

// WHY only until the first ticket: this is first-run guidance, and some steps
// are never "done" for some companies (no phone line, an owner working alone,
// no documents to upload), so it would never go away. Once tickets arrive the
// setup works, and the Setup page alone lists what is left.
async function countSetupStepsLeft(session: SessionContext): Promise<number | null> {
  if (session.role !== "owner") {
    return null;
  }
  if (await companyHasTickets(session.companyId)) {
    return null;
  }
  const checklist = buildSetupChecklist(await getSetupForSession(session));
  return checklist.filter((item) => !item.done).length;
}

// Archived categories don't count: routing never uses them. A company without
// any category gets no hint here (owners see it in the Setup steps).
async function handlesNoActiveCategory(session: SessionContext): Promise<boolean> {
  const [activeCategories, links] = await Promise.all([
    getActiveCategories(session.companyId),
    getUserCategoryLinks(session.companyId),
  ]);
  if (activeCategories.length === 0) {
    return false;
  }
  const activeIds = new Set(activeCategories.map((category) => category.id));
  return !links.some((link) => link.userId === session.userId && activeIds.has(link.categoryId));
}
