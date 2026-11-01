import type { UserRole } from "@/db/schema";

// Who is logged in, for the sidebar's foot and the Setup page, and what
// Home points people to while their part of the setup isn't done.

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
