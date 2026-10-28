import * as React from "react"
import { cn } from "cn"

// A plain <select> that looks like Input and Button (same height, corners,
// border and focus ring), so a menu and its Save button line up. The browser
// draws the list itself, which keeps it simple and works on every phone.
// text-base below md, like Input: iOS Safari zooms the page into any focused
// field whose text is smaller than 16px.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors md:text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
