import { Suspense } from "react";
import type { Metadata } from "next";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { requireSessionContext } from "@/lib/session";
import { getDashboardSummary } from "@/services/dashboard";
import { listTicketsForSession } from "@/services/tickets";
import { TicketTable } from "./ticket-table";

export const metadata: Metadata = { title: "Dashboard - ansa" };

export default function DashboardPage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: anything that reads the session must sit
          inside <Suspense>, because it can only run at request time. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}

// Reads the session once and hands it to everything on the page.
async function DashboardContent() {
  const session = await requireSessionContext();
  const [summary, tickets] = await Promise.all([
    getDashboardSummary(session),
    listTicketsForSession(session),
  ]);

  return (
    <>
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
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Tickets</h1>
        <TicketTable tickets={tickets} />
      </section>
    </>
  );
}
