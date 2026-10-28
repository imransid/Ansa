import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buildSetupChecklist, type SetupOverview } from "@/services/setup";

// The "what's left to set up" list at the top of the Setup page. Which steps
// there are, and when each counts as done: buildSetupChecklist.
export function Checklist({ setup }: { setup: SetupOverview }) {
  return (
    <ul className="grid max-w-xl gap-2">
      {buildSetupChecklist(setup).map((item) => (
        <li key={item.label} className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm">
          {item.href ? (
            <Link href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
          <Badge variant={item.done ? "default" : "outline"}>{item.done ? "done" : "to do"}</Badge>
        </li>
      ))}
    </ul>
  );
}
