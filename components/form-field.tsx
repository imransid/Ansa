import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "tel";
  autoComplete?: string;
  // What the box shows when the form opens, and again after React empties the
  // form when an action has run: pass what was typed (FormErrors.values) so an
  // error never wipes it. Never for a password.
  defaultValue?: string;
  readOnly?: boolean;
  // Every field is required unless it says otherwise.
  required?: boolean;
  // The same limits as the server's Zod schema, so the box stops (or the
  // browser complains) where the check would: lib/form-limits.ts.
  minLength?: number;
  maxLength?: number;
  errors?: string[];
};

// A labelled input with its validation errors underneath. The errors are
// announced by screen readers as they appear (role="alert"), and tied to the
// input (aria-describedby), so they are read again when it gets focus.
export function FormField({
  name,
  label,
  type = "text",
  autoComplete,
  defaultValue,
  readOnly,
  required = true,
  minLength,
  maxLength,
  errors,
}: FormFieldProps) {
  const errorId = `${name}-errors`;
  // Two rules can fail with the same words ("Enter a valid email address"): show them once.
  const uniqueErrors = [...new Set(errors ?? [])];
  const hasErrors = uniqueErrors.length > 0;

  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        readOnly={readOnly}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        aria-invalid={hasErrors}
        aria-describedby={hasErrors ? errorId : undefined}
      />
      {hasErrors && (
        <div id={errorId} role="alert" className="grid gap-1 text-sm text-destructive">
          {uniqueErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
    </div>
  );
}
