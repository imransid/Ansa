import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageLoading } from "@/components/page-loading";
import { RefreshEvery } from "@/components/refresh-every";
import { getOrdersPageFromCore, takesOrdersFromCore } from "@/lib/core-views/orders";
import { requireSessionContext } from "@/lib/session";
import { ordersPageNoticeSchema } from "@/lib/validation/orders";
import { NotToldNotice } from "./not-told-notice";
import { OrderCard } from "./order-card";

export const metadata: Metadata = { title: "Orders - ansa" };

// Orders (step 52): what customers ordered in a chat, ansa's total, and one
// button for the next step (Accept, then Ready, then Done), each sending the
// customer a short message when their chat allows it. Everyone in the
// company works them.
export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-6 p-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Orders customers placed in a chat. Each button sends the customer a short message when their chat allows it.
        </p>
      </div>
      {/* Cache Components rule: the session and the address's notice are only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// ?notTold=&channel=&order=: a change the customer wasn't told about
// (app/actions/orders.ts); anything else in the address shows nothing.
async function OrdersContent({ searchParams }: Pick<PageProps<"/orders">, "searchParams">) {
  const session = await requireSessionContext("/orders");
  const query = await searchParams;
  const notice = ordersPageNoticeSchema.safeParse({ notTold: query.notTold, channel: query.channel, order: query.order });
  const [{ open, finished, packageIncludesOrders }, takesOrders] = await Promise.all([getOrdersPageFromCore(), takesOrdersFromCore()]);
  return (
    <>
      <RefreshEvery />
      {notice.success && <NotToldNotice reason={notice.data.notTold} channel={notice.data.channel} orderNumber={notice.data.order} />}
      {!takesOrders && (
        <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
          ansa doesn&apos;t take orders right now.{" "}
          <Link href="/settings/business" className="font-medium underline">
            Switch on “Take orders”
          </Link>
        </p>
      )}
      {!packageIncludesOrders && (
        <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
          Your package doesn&apos;t include orders: customers&apos; orders go to you as requests (
          {session.role === "owner" ? (
            <Link href="/billing" className="font-medium underline">
              Billing
            </Link>
          ) : (
            "an owner changes the package in Billing"
          )}
          ).
        </p>
      )}
      <section aria-labelledby="open-orders-heading" className="grid gap-3">
        <h2 id="open-orders-heading" className="text-lg font-semibold">
          To do ({open.length})
        </h2>
        {open.length === 0 ? (
          <EmptyState>No orders to do. When a customer orders in a chat, it shows here and you get an alert.</EmptyState>
        ) : (
          <ul className="grid gap-3">
            {open.map((order) => (
              <li key={order.id}>
                <OrderCard order={order} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {finished.length > 0 && (
        <section aria-labelledby="finished-orders-heading" className="grid gap-3">
          <h2 id="finished-orders-heading" className="text-lg font-semibold">
            Finished
          </h2>
          <ul className="grid gap-3">
            {finished.map((order) => (
              <li key={order.id}>
                <OrderCard order={order} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
