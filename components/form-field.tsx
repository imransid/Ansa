import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = {
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  errors?: string[];
};

// A labelled input with its validation errors underneath.
export function FormField({
  name,
  label,
  type = "text",
  autoComplete,
  errors,
}: FormFieldProps) {
  const errorId = `${name}-errors`;
  const hasErrors = errors !== undefined && errors.length > 0;

  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={hasErrors}
        aria-describedby={hasErrors ? errorId : undefined}
      />
      {hasErrors && (
        <ul id={errorId} className="text-sm text-destructive">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
