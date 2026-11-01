import type { UserCategoryLink } from "@/lib/types/user-categories";

// The company's ticket categories, as the Team page, the ticket page and the
// forms' menus read them.

export type Category = {
  id: string;
  name: string;
  archived: boolean;
};

// One active category in a form's menu.
export type CategoryChoice = { id: string; name: string };

export type TeamCategories = {
  categories: Category[];
  links: UserCategoryLink[];
};
