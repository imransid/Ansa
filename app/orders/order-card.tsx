import Link from "next/link";
import { changeOrderStatusAction } from "@/app/actions/orders";
import { ActionButton } from "@/components/action-button";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot, type StatusTone } from "@/components/status-dot";
import { CHANNEL_LABELS } from "@/lib/conversations";
import { contactLabel } from "@/lib/inbox";
import { formatPrice } from "@/lib/menu";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/orders";
import type { OrderView } from "@/lib/types/orders";

const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  proposed: "quiet",
  new: "attention",
  accepted: "info",
  ready: "info",
  done: "success",
  cancelled: "quiet",
};

// One order (step 52), set like a kitchen ticket: number, who and ansa's
// total; each line; how and when; and the one next step as the main button.
export function OrderCard({ order }: { order: OrderView }) {
  const money = (cents: number) => formatPrice(cents, order.currency);
  const customer = contactLabel({ displayName: order.contactName, externalId: "" }) || "A customer";
  return (
    <article aria-label={`Order #${order.orderNumber}`} className="grid gap-3 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-semibold">
          #{order.orderNumber} · {customer}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{CHANNEL_LABELS[order.channel]}</span>
        </h3>
        <span className="text-lg font-semibold numbers">{money(order.totalCents)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusDot tone={STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</StatusDot>
        {order.placedAt && (
          <span className="text-xs text-subtle-foreground">
            Placed <LocalDateTime iso={order.placedAt.toISOString()} />
          </span>
        )}
      </div>
      <ul className="divide-y border-y text-sm">
        {order.lines.map((line, index) => (
          <li key={index} className="flex justify-between gap-4 py-1.5">
            <span>
              {line.quantity} × {line.name}
            </span>
            <span className="numbers">{money(line.lineTotalCents)}</span>
          </li>
        ))}
        {order.deliveryFeeCents > 0 && (
          <li className="flex justify-between gap-4 py-1.5 text-muted-foreground">
            <span>Delivery</span>
            <span className="numbers">{money(order.deliveryFeeCents)}</span>
          </li>
        )}
      </ul>
      <dl className="grid gap-1 text-sm sm:grid-cols-[7rem_1fr]">
        <dt className="text-muted-foreground">{order.fulfilment === "delivery" ? "Deliver to" : "Pickup"}</dt>
        <dd className="wrap-anywhere">{order.fulfilment === "delivery" ? order.address : "The customer picks it up"}</dd>
        <dt className="text-muted-foreground">When</dt>
        <dd>{order.wantedTime}</dd>
        {order.notes && (
          <>
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="wrap-anywhere">{order.notes}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap items-start gap-2">
        <NextStep order={order} />
        <Link href={`/inbox/${order.conversationId}`} className="self-center text-sm underline">
          Open the conversation
        </Link>
      </div>
    </article>
  );
}

// The one thing to do next, and Cancel (asks first: the customer is told).
function NextStep({ order }: { order: OrderView }) {
  const fields = (change: string) => ({ orderId: order.id, change });
  const name = `order #${order.orderNumber}`;
  if (order.status === "done" || order.status === "cancelled" || order.status === "proposed") {
    return null;
  }
  return (
    <>
      {order.status === "new" && (
        <ActionButton action={changeOrderStatusAction} fields={fields("accept")} label="Accept" accessibleLabel={`Accept ${name}`} look="primary" />
      )}
      {order.status === "accepted" && (
        <ActionButton
          action={changeOrderStatusAction}
          fields={fields("ready")}
          label={order.fulfilment === "delivery" ? "On its way" : "Ready to pick up"}
          accessibleLabel={`${name}: ${order.fulfilment === "delivery" ? "on its way" : "ready to pick up"}`}
          look="primary"
        />
      )}
      {(order.status === "accepted" || order.status === "ready") && (
        <ActionButton action={changeOrderStatusAction} fields={fields("done")} label="Done" accessibleLabel={`Done: ${name}`} look={order.status === "ready" ? "primary" : "small"} />
      )}
      <ConfirmButton
        action={changeOrderStatusAction}
        fields={fields("cancel")}
        label={order.status === "new" ? "Can't take it" : "Cancel"}
        accessibleLabel={`Cancel ${name}`}
        question={`Cancel ${name}? The customer gets a message that it was cancelled.`}
        confirmLabel="Yes, cancel it"
        pendingLabel="Cancelling..."
      />
    </>
  );
}
