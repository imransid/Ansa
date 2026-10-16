"use client";

import { useActionState } from "react";
import { setTicketCategoryAction } from "@/app/actions/categories";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type TicketCategoryFormProps = {
  ticketId: string;
  category: string | null;
  // The company's active categories.
  categoryNames: string[];
};

// Sets the ticket's category. If the ticket is unassigned, saving a category
// also routes it to an expert for that category.
export function TicketCategoryForm({ ticketId, category, categoryNames }: TicketCategoryFormProps) {
  const [errors, saveAction, isSaving] = useActionState(setTicketCategoryAction, undefined);
  // An archived category stays on old tickets, so keep it in the menu for them.
  const options = category && !categoryNames.includes(category) ? [category, ...categoryNames] : categoryNames;

  return (
    <form action={saveAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <div className="grid gap-2">
        <Label htmlFor="ticket-category">Category</Label>
        <select
          key={category ?? "none"}
          id="ticket-category"
          name="category"
          defaultValue={category ?? ""}
          className="h-9 min-w-48 rounded-md border bg-transparent px-3 text-sm"
        >
          <option value="">No category</option>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="outline" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save"}
      </Button>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}
