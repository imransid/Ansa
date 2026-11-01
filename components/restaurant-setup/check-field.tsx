import { Checkbox } from "@/components/ui/checkbox";

// A checkbox with its label and a line saying what it means.
export function CheckField({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={name} name={name} defaultChecked={defaultChecked} aria-describedby={`${name}-hint`} className="mt-0.5" />
      <div className="grid gap-0.5">
        <label htmlFor={name} className="text-sm font-semibold">
          {label}
        </label>
        <p id={`${name}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}
