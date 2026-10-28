import { LocalDateTime } from "@/components/local-date-time";
import type { SetupOverview } from "@/services/setup";

// The company's phone numbers, read-only. ansa links them (pnpm
// link:phone-line), because the numbers live in ansa's own Vapi account. Each
// shows its last call, so a number that never gets any stands out.
export function PhoneSection({ phoneLines }: { phoneLines: SetupOverview["phoneLines"] }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Phone numbers</h2>
      <p className="text-sm text-muted-foreground">
        ansa sets up your phone number and links it here. Calls to it show up on the Calls page.
      </p>
      {phoneLines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No phone number yet.</p>
      ) : (
        <ul className="grid max-w-xl gap-1 text-sm">
          {phoneLines.map((line) => (
            <li key={line.vapiPhoneNumberId} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Vapi number id</span>
              <span className="font-mono">{line.vapiPhoneNumberId}</span>
              <span>
                {line.lastCallAt ? (
                  <>
                    Last call received: <LocalDateTime iso={line.lastCallAt.toISOString()} />
                  </>
                ) : (
                  "No calls received yet"
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
