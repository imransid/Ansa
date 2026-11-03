import Link from "next/link";
import type { ConversationChannel } from "@/lib/conversations";
import { orderNotToldText, type OrderNotToldReason } from "@/lib/order-notices";

// A change the customer wasn't told about (app/actions/orders.ts put it in
// the page's address): which order, and why, in words for the customer's
// channel. It stays until dismissed: the order's own button is gone.
export function NotToldNotice({ reason, channel, orderNumber }: { reason: OrderNotToldReason; channel: ConversationChannel; orderNumber: number }) {
  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-xl bg-attention-surface px-4 py-3 text-sm">
      <p>
        <span className="font-semibold">Order #{orderNumber}:</span> {orderNotToldText(reason, channel)}
      </p>
      <Link href="/orders" replace scroll={false} className="underline">
        Dismiss
      </Link>
    </div>
  );
}
