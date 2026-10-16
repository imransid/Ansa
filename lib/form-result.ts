// What a form shows the user when something went wrong.
// fieldErrors go under a specific input, message goes at the top of the form.
export type FormErrors = {
  fieldErrors?: Record<string, string[] | undefined>;
  message?: string;
};

// What a service returns to a form's server action.
export type FormResult = { ok: true } | { ok: false; errors: FormErrors };
