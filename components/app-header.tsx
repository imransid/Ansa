import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import type { DashboardSummary } from "@/services/dashboard";

type AppHeaderProps = {
  summary: DashboardSummary;
};

// The top bar on every signed-in page: navigation, who you are, and log out.
export function AppHeader({ summary }: AppHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
      <nav className="flex gap-4 text-sm font-medium">
        <Link href="/dashboard" className="hover:underline">
          Tickets
        </Link>
        <Link href="/team" className="hover:underline">
          Team
        </Link>
      </nav>
      <div className="flex items-center gap-4">
        <p className="text-sm">
          You are <strong>{summary.email}</strong>, {summary.role} at{" "}
          <strong>{summary.companyName}</strong>
        </p>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Log out
          </Button>
        </form>
      </div>
    </header>
  );
}
