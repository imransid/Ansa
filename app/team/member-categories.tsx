"use client";

import { useActionState, useState } from "react";
import { setUserCategoriesAction } from "@/app/actions/categories";
import { Button } from "@/components/ui/button";
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

  if (!isEditing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{handledNames.length > 0 ? handledNames.join(", ") : "None"}</span>
        {canEdit && activeCategories.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={saveAction} className="grid gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-wrap gap-3">
        {activeCategories.map((category) => (
          <label key={category.id} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              name="categoryIds"
              value={category.id}
              defaultChecked={handledCategoryIds.includes(category.id)}
            />
            {category.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
          Cancel
        </Button>
      </div>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}
