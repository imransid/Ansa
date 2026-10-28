"use client";

import { useActionState, useState } from "react";
import { setCompanyNameAction } from "@/app/actions/setup";
import { FormField } from "@/components/form-field";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MIN_LENGTH } from "@/lib/form-limits";

// Says "Saved." when it worked, and keeps what was typed when it didn't.
export function CompanyNameForm({ current }: { current: string }) {
  const [state, action, isSaving] = useActionState(setCompanyNameAction, undefined);
  // "Saved." is about the name that was saved: typing again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  return (
    <form
      action={action}
      onInput={() => setChangedSinceSave(true)}
      onSubmit={() => setChangedSinceSave(false)}
      className="flex max-w-xl flex-wrap items-end gap-2"
    >
      <FormField
        name="companyName"
        label="Company name"
        autoComplete="organization"
        defaultValue={state?.errors?.values?.companyName ?? current}
        minLength={COMPANY_NAME_MIN_LENGTH}
        maxLength={COMPANY_NAME_MAX_LENGTH}
        errors={state?.errors?.fieldErrors?.companyName}
      />
      <Button type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save"}
      </Button>
      <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />
      {state?.errors?.message && (
        <p role="alert" className="w-full text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
    </form>
  );
}
