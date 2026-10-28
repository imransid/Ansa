"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type PlanChoiceSelectProps = {
  id: string;
  name: string;
  label: string;
  // The names the current marketing plan has.
  choices: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

// A menu of the current marketing plan's pillars or campaigns (step 38),
// for "New draft" and the editor. A draft keeps the name it was given, so a
// name the current plan no longer has stays on the menu, marked as such.
// Controlled by its form, which sends its action from onSubmit: after a
// plain <form action>, React's reset would show the first option again
// while the form's state still holds the pick (a check keeps it so).
export function PlanChoiceSelect({ id, name, label, choices, value, onChange, disabled }: PlanChoiceSelectProps) {
  const isOldChoice = value !== "" && !choices.includes(value);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} name={name} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">None</option>
        {/* By position: a plan may give two pillars the same name. */}
        {choices.map((choice, index) => (
          <option key={index} value={choice}>
            {choice}
          </option>
        ))}
        {isOldChoice && <option value={value}>{value} (not in the current plan)</option>}
      </NativeSelect>
    </div>
  );
}
