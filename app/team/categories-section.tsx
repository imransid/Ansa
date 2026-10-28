"use client";

import { useActionState, useState } from "react";
import { createCategoryAction, renameCategoryAction, setCategoryArchivedAction } from "@/app/actions/categories";
import { FormField } from "@/components/form-field";
import { SavedNote } from "@/components/saved-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORY_NAME_MAX_LENGTH } from "@/lib/form-limits";
import type { Category } from "@/services/categories";

// Owners only (the page hides this for members; the services refuse them anyway).
export function CategoriesSection({ categories }: { categories: Category[] }) {
  return (
    <div className="grid max-w-xl gap-3">
      {categories.length === 0 && (
        <p className="text-sm text-muted-foreground">No categories yet. Tickets stay unassigned until one fits.</p>
      )}
      {/* Keyed by id only: a rename keeps the row, so its "Saved" can show. */}
      {categories.map((category) => (
        <CategoryRow key={category.id} category={category} />
      ))}
      <AddCategoryForm />
    </div>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const [renameState, renameAction, isRenaming] = useActionState(renameCategoryAction, undefined);
  const [archiveErrors, archiveAction, isArchiving] = useActionState(setCategoryArchivedAction, undefined);
  // "Saved." is about the name that was saved: typing again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const renameErrors = renameState?.errors;
  const renameMessage = renameErrors?.message ?? renameErrors?.fieldErrors?.name?.[0];
  const message = renameMessage ?? archiveErrors?.message;
  const messageId = `category-${category.id}-message`;

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <form
          action={renameAction}
          onInput={() => setChangedSinceSave(true)}
          onSubmit={() => setChangedSinceSave(false)}
          className="flex items-center gap-2"
        >
          <input type="hidden" name="categoryId" value={category.id} />
          {/* After a refused rename it keeps what was typed, not the old name. */}
          <Input
            name="name"
            defaultValue={renameErrors?.values?.name ?? category.name}
            maxLength={CATEGORY_NAME_MAX_LENGTH}
            required
            aria-label={`Name of ${category.name}`}
            aria-invalid={renameMessage ? true : undefined}
            aria-describedby={renameMessage ? messageId : undefined}
            className="w-56"
          />
          <Button type="submit" variant="outline" size="sm" disabled={isRenaming}>
            {isRenaming ? "Saving..." : "Rename"}
          </Button>
        </form>
        <form action={archiveAction}>
          <input type="hidden" name="categoryId" value={category.id} />
          <input type="hidden" name="archived" value={category.archived ? "false" : "true"} />
          <Button type="submit" variant="ghost" size="sm" disabled={isArchiving}>
            {category.archived ? "Restore" : "Archive"}
          </Button>
        </form>
        {category.archived && <Badge variant="outline">archived</Badge>}
        <SavedNote saved={renameState?.saved === true && !isRenaming && !changedSinceSave} />
      </div>
      {message && (
        <p id={messageId} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

function AddCategoryForm() {
  const [errors, addAction, isAdding] = useActionState(createCategoryAction, undefined);
  return (
    <form action={addAction} className="flex flex-wrap items-end gap-2">
      {/* Cleared when the category was added; kept when it was refused. */}
      <FormField
        name="name"
        label="New category"
        defaultValue={errors?.values?.name}
        maxLength={CATEGORY_NAME_MAX_LENGTH}
        errors={errors?.fieldErrors?.name}
      />
      <Button type="submit" disabled={isAdding}>
        {isAdding ? "Adding..." : "Add category"}
      </Button>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}
