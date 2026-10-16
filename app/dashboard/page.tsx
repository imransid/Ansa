import { Suspense } from "react";
import type { Metadata } from "next";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { requireSessionContext } from "@/lib/session";
import { getDashboardSummary } from "@/services/dashboard";

export const metadata: Metadata = { title: "Dashboard - ansa" };

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      {/* Cache Components rule: anything that reads the session must sit
          inside <Suspense>, because it can only run at request time. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <CurrentUserHeader />
      </Suspense>
    </main>
  );
}

async function CurrentUserHeader() {
  const session = await requireSessionContext();
  const summary = await getDashboardSummary(session);

  return (
    <div className="flex items-center justify-between gap-4">
      <p>
        You are <strong>{summary.email}</strong>, {summary.role} at{" "}
        <strong>{summary.companyName}</strong>
      </p>
      <form action={logoutAction}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </div>
  );
}
