import "server-only";
import { getCompanyById } from "@/db/companies";
import type { UserRole } from "@/db/schema";
import type { SessionContext } from "@/lib/session";

export type DashboardSummary = {
  userName: string;
  email: string;
  role: UserRole;
  companyName: string;
};

// Gathers what the dashboard header shows for the logged-in user.
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
