import { deleteMenuItemAction, moveMenuItemAction, setMenuItemAvailabilityAction } from "@/app/actions/menu";
import { ConfirmButton } from "@/components/confirm-button";
import { StatusDot } from "@/components/status-dot";
import { formatPrice, priceForEditing } from "@/lib/menu";
import { ActionButton } from "@/components/action-button";
import type { MenuItemRow } from "@/lib/types/menu";
import { DishForm } from "./dish-form";

type DishRowProps = {
  dish: MenuItemRow;
  currency: string;
  categories: string[];
  canEdit: boolean;
};

// One dish as the menu page shows it, set like a printed menu: the name, a
// dotted line, the price. Everyone can switch it off for today; owners also
// edit, move and delete it.
export function DishRow({ dish, currency, categories, canEdit }: DishRowProps) {
  return (
    <li className="grid gap-3 py-4">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{dish.name}</span>
        <span aria-hidden className="min-w-6 flex-1 -translate-y-1 border-b-[1.5px] border-dotted border-border" />
        <span className="font-display text-lg numbers">{formatPrice(dish.priceCents, currency)}</span>
      </div>
      {dish.description && <p className="-mt-2 text-sm text-muted-foreground">{dish.description}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {dish.available ? <StatusDot tone="success">Available</StatusDot> : <StatusDot tone="attention">Not available today</StatusDot>}
        <span className="flex-1" />
        <ActionButton
          action={setMenuItemAvailabilityAction}
          fields={{ itemId: dish.id, available: dish.available ? "false" : "true" }}
          label={dish.available ? "Not available today" : "Available again"}
          accessibleLabel={dish.available ? `Mark ${dish.name} not available today` : `Mark ${dish.name} available again`}
        />
        {canEdit && (
          <div className="flex w-full justify-end gap-2 sm:w-auto">
            <ActionButton action={moveMenuItemAction} fields={{ itemId: dish.id, direction: "up" }} label="Up" accessibleLabel={`Move ${dish.name} up`} />
            <ActionButton action={moveMenuItemAction} fields={{ itemId: dish.id, direction: "down" }} label="Down" accessibleLabel={`Move ${dish.name} down`} />
            <ConfirmButton
              action={deleteMenuItemAction}
              fields={{ itemId: dish.id }}
              label="Delete"
              accessibleLabel={`Delete ${dish.name}`}
              question={`Take ${dish.name} off the menu for good? To hide it for today only, use "Not available today".`}
              confirmLabel="Yes, delete"
              pendingLabel="Deleting..."
            />
          </div>
        )}
      </div>
      {canEdit && (
        <details className="rounded-xl bg-muted/50 px-4 py-2 [&[open]]:pb-4">
          <summary className="cursor-pointer text-sm font-semibold">Edit {dish.name}</summary>
          <div className="pt-4">
            <DishForm
              dish={{ id: dish.id, category: dish.category, name: dish.name, description: dish.description, price: priceForEditing(dish.priceCents, currency) }}
              categories={categories}
              currency={currency}
            />
          </div>
        </details>
      )}
    </li>
  );
}
