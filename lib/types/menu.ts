// The restaurant's menu (step 46) as Settings → Menu shows it. Prices are
// stored in cents of the restaurant's currency, so a menu needs a currency
// first (setup's orders step).

export type MenuItemRow = {
  id: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
};

export type MenuView = {
  items: MenuItemRow[];
  // null until setup's orders step chose one: nothing can be priced yet.
  currency: string | null;
  canEdit: boolean;
};
