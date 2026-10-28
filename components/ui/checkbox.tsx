import * as React from "react"
import { cn } from "cn"

// A plain checkbox in the app's colors (accent-color), the same size in every
// browser. It stays a real <input>, so forms send it like any other field.
function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn("size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  )
}

export { Checkbox }
