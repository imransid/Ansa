import { cn } from "@/lib/utils";

export type TicketLine = { quantity: number | null; name: string; price: string };

type OrderTicketProps = {
  title: string;
  // A short line beside the title: "Delivery · 21:42".
  detail: string;
  lines: TicketLine[];
  total: string;
  // The small print under the total, if any.
  note?: string;
  className?: string;
};

// An order set like a printed kitchen ticket: torn top edge, the dishes with
// dotted lines to their prices, a large serif total. Shown by the website's
// first hero; unused since its rewrite of 2026-11-01 (the Orders page, step
// 52, has its own card, app/orders/order-card.tsx). Step 57 decides.
export function OrderTicket({ title, detail, lines, total, note, className }: OrderTicketProps) {
  return (
    <div className={cn("ticket-edge rounded-b-xl bg-[#fbf8f1] px-5 pt-7 pb-5 text-[#11211a] shadow-[0_18px_40px_rgb(0_10_5/0.35),0_2px_6px_rgb(0_10_5/0.25)]", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-dashed border-[#11211a]/25 pb-2.5">
        <span className="font-display text-[1.375rem]">{title}</span>
        <span className="text-xs text-[#55665d]">{detail}</span>
      </div>
      <ul className="grid gap-1.5 py-1">
        {lines.map((line) => (
          <li key={line.name} className="flex items-baseline text-sm">
            <span className="w-7 shrink-0 text-[#55665d] numbers">{line.quantity ? `${line.quantity} ×` : ""}</span>
            <span>{line.name}</span>
            <span aria-hidden className="mx-2 min-w-4 flex-1 -translate-y-1 border-b-[1.5px] border-dotted border-[#11211a]/30" />
            <span className="font-display text-base numbers">{line.price}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t border-[#11211a]/20 pt-2.5">
        <span className="text-[0.8125rem] font-semibold text-[#55665d]">Total</span>
        <span className="font-display text-[2rem] leading-none text-[#0e4a38] numbers">{total}</span>
      </div>
      {note && <p className="mt-2.5 text-xs text-[#55665d]">{note}</p>}
    </div>
  );
}
