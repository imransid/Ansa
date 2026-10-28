"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { setUserCategoriesAction } from "@/app/actions/categories";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Category } from "@/services/categories";

type MemberCategoriesProps = {
  userId: string;
  // Only active categories can be picked.
  activeCategories: Category[];
  handledCategoryIds: string[];
  // Your own row, or any row if you are an owner. The service checks this again.
  canEdit: boolean;
};

// Which categories one person handles, with checkboxes to change it.
export function MemberCategories({ userId, activeCategories, handledCategoryIds, canEdit }: MemberCategoriesProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [errors, saveAction, isSaving] = useActionState(setUserCategoriesAction, undefined);
  const handledNames = activeCategories
    .filter((category) => handledCategoryIds.includes(category.id))
    .map((category) => category.name);
  const errorId = `categories-of-${userId}-error`;

  // WHY by hand: when <form action> runs an action, React resets the form's
  // fields afterwards, so after an error ("Too many changes") the boxes would
  // go back to the saved ones. An action started here, in a transition, runs
  // without that reset, so the boxes stay as the person ticked them.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => saveAction(formData));
  }

  if (!isEditing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{handledNames.length > 0 ? handledNames.join(", ") : <NoCategories />}</span>
        {canEdit && activeCategories.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={saveAction} onSubmit={submit} className="grid gap-2">
      <input type="hidden" name="userId" value={userId} />
      <fieldset className="flex flex-wrap gap-3" aria-describedby={errors?.message ? errorId : undefined}>
        <legend className="sr-only">Categories handled</legend>
        {activeCategories.map((category) => (
          <label key={category.id} className="flex items-center gap-1.5 text-sm">
            <Checkbox name="categoryIds" value={category.id} defaultChecked={handledCategoryIds.includes(category.id)} />
            {category.name}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
          Cancel
        </Button>
      </div>
      {errors?.message && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}

// "None" alone didn't say what it costs (step 32).
function NoCategories() {
  return <span className="text-muted-foreground">None (routing by category skips this person)</span>;
}
