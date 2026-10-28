// "Saved." next to an inline form once its save worked: the field alone looks
// the same before and after. Always in the page (empty until then), so screen
// readers announce the change (role="status" is a polite live region).
export function SavedNote({ saved }: { saved: boolean }) {
  return (
    <span role="status" className="text-sm text-muted-foreground">
      {saved ? "Saved." : ""}
    </span>
  );
}
