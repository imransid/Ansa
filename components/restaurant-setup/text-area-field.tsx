import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldErrors, FieldHint } from "./section-form";

type TextAreaFieldProps = {
  name: string;
  label: string;
  hint?: string;
  defaultValue: string;
  maxLength: number;
  required?: boolean;
  rows?: number;
  errors?: string[];
};

// A labelled box of several lines, with its help line and mistakes tied to it.
export function TextAreaField({ name, label, hint, defaultValue, maxLength, required = false, rows = 3, errors }: TextAreaFieldProps) {
  const hasErrors = (errors?.length ?? 0) > 0;
  const describedBy = [hint ? `${name}-hint` : "", hasErrors ? `${name}-errors` : ""].filter(Boolean).join(" ");
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        rows={rows}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        aria-invalid={hasErrors || undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint && <FieldHint id={`${name}-hint`}>{hint}</FieldHint>}
      <FieldErrors id={`${name}-errors`} errors={errors} />
    </div>
  );
}
