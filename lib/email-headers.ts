// The value of one header of a received email, found whatever its letter case
// ("List-Unsubscribe", "list-unsubscribe"), or "" when it is missing.
export function readHeader(headers: Record<string, string>, name: string): string {
  const wanted = name.toLowerCase();
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
  return found?.[1] ?? "";
}
