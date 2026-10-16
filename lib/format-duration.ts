// Formats how long a call took, like "4m 05s". Returns "-" if a time is missing.
export function formatCallDuration(startedAt: Date | null, endedAt: Date | null): string {
  if (!startedAt || !endedAt) {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
