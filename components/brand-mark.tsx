import { ConciergeBell } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  // On the forest-green frame (the sidebar): a brass bell and an ivory name.
  // Elsewhere: a green bell (brass in dark mode) and the page's text colour.
  onGreen?: boolean;
  className?: string;
};

// ansa's mark (step 44): a concierge bell, because ansa greets the
// restaurant's guests and rings for the owner only when it matters, and the
// name set in Fraunces. Screen readers read the name; the bell is decoration.
export function BrandMark({ onGreen = false, className }: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <ConciergeBell aria-hidden strokeWidth={1.6} className={cn("size-5.5 shrink-0", onGreen ? "text-brass" : "text-link dark:text-brass")} />
      <span className={cn("font-display text-2xl leading-none", onGreen ? "text-ivory" : "text-foreground")}>ansa</span>
    </span>
  );
}
