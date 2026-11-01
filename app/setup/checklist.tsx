import Link from "next/link";
import { StatusDot } from "@/components/status-dot";
import { buildSetupChecklist, type SetupOverview } from "@/services/setup";

// The "what's left to set up" list at the top of the Setup page: rows on one
// sheet, each with its state as a dot and a word. Which steps there are, and
// when each counts as done: buildSetupChecklist.
export function Checklist({ setup }: { setup: SetupOverview }) {
  return (
    <ul className="grid max-w-xl divide-y border-y">
      {buildSetupChecklist(setup).map((item) => (
        <li key={item.label} className="flex min-h-12 items-center justify-between gap-4 py-2 text-sm">
          {item.href ? (
            <Link href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
          {item.done ? (
            <StatusDot tone="success" className="shrink-0">
              Done
            </StatusDot>
          ) : (
            <StatusDot tone="attention" className="shrink-0">
              To do
            </StatusDot>
          )}
        </li>
      ))}
    </ul>
  );
}
