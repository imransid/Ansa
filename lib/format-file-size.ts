// Formats a file's size for a list, like "340 KB" or "3.2 MB": the Setup
// page's documents and the media library (also its total, "0 KB" when empty).
export function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
