// Hangs up a practice call through its own route (app/api/phone/practice/end),
// never a server action: those wait behind the turn ansa is still thinking
// about, and core must hear the hang-up at once to drop that answer.
// keepalive: the request outlives a page being left. False when core
// couldn't be told (the same caller's next call then ends it).
export async function hangUpPracticeCall(callId: string): Promise<boolean> {
  const response = await fetch("/api/phone/practice/end", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId }),
  }).catch(() => null);
  return response?.ok ?? false;
}
