import { describeConnectResult, type ConnectResult } from "@/lib/social-errors";
import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/lib/social-platforms";

// What the last return from a platform came to, from the result code in the
// page's address (never anything the platform wrote). A success is
// announced politely, a failure as an alert.
export function ConnectResultMessage({ result, platform, count }: { result: ConnectResult; platform: SocialPlatform; count: number | null }) {
  const message = describeConnectResult(result, SOCIAL_PLATFORM_LABELS[platform], count);
  if (result === "connected") {
    return (
      <p role="status" className="max-w-3xl rounded-md border px-3 py-2 text-sm">
        {message}
      </p>
    );
  }
  return (
    <p role="alert" className="max-w-3xl rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}
