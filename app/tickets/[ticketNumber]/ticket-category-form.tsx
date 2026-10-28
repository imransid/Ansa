"use client";

import { useActionState, useState } from "react";
import { setTicketCategoryAction } from "@/app/actions/categories";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type TicketCategoryFormProps = {
  ticketId: string;
  category: string | null;
  // The company's active categories.
  categoryNames: string[];
};

// Sets the ticket's category. If the ticket is open and unassigned, saving a
// category (also the one it already has) routes it to an expert for that
// category. Says "Saved." when it worked: the menu looks the same either way.
export function TicketCategoryForm({ ticketId, category, categoryNames }: TicketCategoryFormProps) {
  const [state, saveAction, isSaving] = useActionState(setTicketCategoryAction, undefined);
  // "Saved." is about the category that was saved: picking another hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const errorMessage = state?.errors?.message ?? state?.errors?.fieldErrors?.category?.[0];
  // After a refused save: the category picked, not the saved one.
  const shownCategory = state?.errors?.values?.category ?? category ?? "";
  // An archived category stays on old tickets, so keep it in the menu for them.
  const options = category && !categoryNames.includes(category) ? [category, ...categoryNames] : categoryNames;

  return (
    <form
      action={saveAction}
      onInput={() => setChangedSinceSave(true)}
      onSubmit={() => setChangedSinceSave(false)}
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <div className="grid gap-2">
        <Label htmlFor="ticket-category">Category</Label>
        {/* key: React reads a select's defaultValue only when it first renders,
            and empties the form after the action. A new key builds the menu
            again whenever the category to show changes (saved, or sent back). */}
        <NativeSelect
          key={shownCategory}
          id="ticket-category"
          name="category"
          defaultValue={shownCategory}
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorMessage ? "ticket-category-error" : undefined}
          className="min-w-48 max-w-full"
        >
          <option value="">No category</option>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save"}
      </Button>
      <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />
      {errorMessage && (
        <p id="ticket-category-error" role="alert" className="w-full text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
