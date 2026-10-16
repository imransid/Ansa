import { Suspense } from "react";
import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { requireSessionContext } from "@/lib/session";
import { getBillingForSession } from "@/services/billing";
import { getDashboardSummary } from "@/services/dashboard";
import { BillingPanel } from "./billing-panel";

export const metadata: Metadata = { title: "Billing - ansa" };

export default function BillingPage({ searchParams }: PageProps<"/billing">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <BillingContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function BillingContent({ searchParams }: Pick<PageProps<"/billing">, "searchParams">) {
  const session = await requireSessionContext();
  const [summary, billing, query] = await Promise.all([getDashboardSummary(session), getBillingForSession(session), searchParams]);

  return (
    <>
      <AppHeader summary={summary} />
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Billing</h1>
        {billing ? (
          <BillingPanel billing={billing} justCheckedOut={query.checkout === "done"} />
        ) : (
          <p className="text-sm text-muted-foreground">Only owners can see billing.</p>
        )}
      </section>
    </>
  );
}
