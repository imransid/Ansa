// One line of a practice call: ansa's words or the caller's.
export type Line = { who: "ansa" | "caller"; text: string };

type Props = { lines: Line[]; callerName: string; thinking: boolean };

// What was said on the practice call, in order, read out to screen readers as it comes.
export function CallLog({ lines, callerName, thinking }: Props) {
  return (
    <ol role="log" aria-live="polite" className="grid gap-2 text-sm">
      {lines.map((line, index) => (
        <li key={index} className={line.who === "ansa" ? "rounded-2xl bg-secondary p-3" : "justify-self-end rounded-2xl border p-3"}>
          <span className="block text-xs text-muted-foreground">{line.who === "ansa" ? "ansa" : callerName || "Caller"}</span>
          {line.text}
        </li>
      ))}
      {thinking && <li className="text-muted-foreground">ansa is thinking...</li>}
    </ol>
  );
}
