"use client";

import { useActionState, useState } from "react";
import { addMenuItemAction, updateMenuItemAction } from "@/app/actions/menu";
import { FormField } from "@/components/form-field";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { MENU_CATEGORY_MAX_LENGTH, MENU_DESCRIPTION_MAX_LENGTH, MENU_NAME_MAX_LENGTH, MENU_PRICE_TEXT_MAX_LENGTH } from "@/lib/menu";

type DishFormProps = {
  // An existing dish (edit), or none (add a new one).
  dish?: { id: string; category: string; name: string; description: string; price: string };
  // The menu's categories so far, offered while typing one.
  categories: string[];
  currency: string;
};

// Adding or changing one dish (step 46). After a refused save it shows what
// was typed again; after adding, the form empties for the next dish.
export function DishForm({ dish, categories, currency }: DishFormProps) {
  const [state, action, isSaving] = useActionState(dish ? updateMenuItemAction : addMenuItemAction, undefined);
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const errors = state?.errors?.fieldErrors;
  const typed = state?.errors?.values;
  // Each form's own ids, so an add form and several edit forms can share a page.
  const prefix = dish ? `dish-${dish.id}` : "new-dish";
  return (
    <form action={action} onInput={() => setChangedSinceSave(true)} onSubmit={() => setChangedSinceSave(false)} className="grid gap-4">
      {dish && <input type="hidden" name="itemId" value={dish.id} />}
      {state?.errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id={`${prefix}-name`}
          name="name"
          label="Dish"
          defaultValue={typed?.name ?? dish?.name}
          maxLength={MENU_NAME_MAX_LENGTH}
          errors={errors?.name}
        />
        <FormField
          id={`${prefix}-price`}
          name="price"
          label={`Price (${currency})`}
          inputMode="decimal"
          defaultValue={typed?.price ?? dish?.price}
          maxLength={MENU_PRICE_TEXT_MAX_LENGTH}
          errors={errors?.price}
        />
        <FormField
          id={`${prefix}-category`}
          name="category"
          label="Category (optional)"
          list={`${prefix}-categories`}
          required={false}
          defaultValue={typed?.category ?? dish?.category}
          maxLength={MENU_CATEGORY_MAX_LENGTH}
          errors={errors?.category}
        />
        <datalist id={`${prefix}-categories`}>
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <FormField
          id={`${prefix}-description`}
          name="description"
          label="Description (optional)"
          required={false}
          defaultValue={typed?.description ?? dish?.description}
          maxLength={MENU_DESCRIPTION_MAX_LENGTH}
          errors={errors?.description}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : dish ? "Save dish" : "Add dish"}
        </Button>
        <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />
      </div>
    </form>
  );
}
