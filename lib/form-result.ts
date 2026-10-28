// What a form shows the user when something went wrong.
// fieldErrors go under a specific input, message goes at the top of the form.
// values: what was typed in the form's text fields, sent back so the form can
// show it again. React empties a form after its action runs, and nobody
// should type a whole form twice because of one mistake. Never a password.
export type FormErrors = {
  fieldErrors?: Record<string, string[] | undefined>;
  message?: string;
  values?: Record<string, string>;
};

// What a service returns to a form's server action.
export type FormResult = { ok: true } | { ok: false; errors: FormErrors };

// What an inline "Save" form shows after it ran: the errors of a refused save,
// or saved: true, so it can say "Saved" (the field alone looks the same).
export type SaveState = { errors?: FormErrors; saved?: boolean };

// As long as the longest field a form gets back (a web page's address,
// KNOWLEDGE_SOURCE_URL_MAX_LENGTH in lib/knowledge/limits.ts): a longer value
// was not typed in our form, and is not sent back whole.
const LONGEST_VALUE_SENT_BACK = 2000;

// Adds what was typed in these fields to a form's errors. Only list fields
// the person can see and retype: NEVER a password field.
export function withTypedValues(errors: FormErrors, formData: FormData, fieldNames: string[]): FormErrors {
  const values: Record<string, string> = {};
  for (const name of fieldNames) {
    const value = formData.get(name);
    if (typeof value === "string") {
      values[name] = value.slice(0, LONGEST_VALUE_SENT_BACK);
    }
  }
  return { ...errors, values };
}
