"use client";

import { useActionState } from "react";
import { createCategoryAction, renameCategoryAction, setCategoryArchivedAction } from "@/app/actions/categories";
import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Category } from "@/services/categories";

// Owners only (the page hides this for members; the services refuse them anyway).
export function CategoriesSection({ categories }: { categories: Category[] }) {
  return (
    <div className="grid max-w-xl gap-3">
      {categories.length === 0 && (
        <p className="text-sm text-muted-foreground">No categories yet. Tickets stay unassigned until one fits.</p>
      )}
      {categories.map((category) => (
        <CategoryRow key={`${category.id}-${category.name}-${category.archived}`} category={category} />
      ))}
      <AddCategoryForm />
    </div>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const [renameErrors, renameAction, isRenaming] = useActionState(renameCategoryAction, undefined);
  const [archiveErrors, archiveAction, isArchiving] = useActionState(setCategoryArchivedAction, undefined);
  const message = renameErrors?.message ?? renameErrors?.fieldErrors?.name?.[0] ?? archiveErrors?.message;

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={renameAction} className="flex items-center gap-2">
          <input type="hidden" name="categoryId" value={category.id} />
          <Input name="name" defaultValue={category.name} aria-label={`Name of ${category.name}`} className="w-56" />
          <Button type="submit" variant="outline" size="sm" disabled={isRenaming}>
            Rename
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
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
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
      <FormField name="name" label="New category" errors={errors?.fieldErrors?.name} />
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
