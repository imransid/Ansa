import { Suspense } from "react";
import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { requireSessionContext } from "@/lib/session";
import { getDashboardSummary } from "@/services/dashboard";
import { getTicketCountsForSession, listTicketsForSession } from "@/services/tickets";
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
  const [summary, tickets, counts] = await Promise.all([
    getDashboardSummary(session),
    listTicketsForSession(session),
    getTicketCountsForSession(session),
  ]);

  return (
    <>
      <AppHeader summary={summary} />
      <section className="grid gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            {counts.open} open · {counts.solved} solved
          </p>
        </div>
        <TicketTable tickets={tickets} />
      </section>
    </>
  );
}
