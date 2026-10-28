"use client";

import { useSearchParams } from "next/navigation";

// Shown on /login?reset=done, where the reset page sends people once their
// new password is saved.
export function PasswordResetNote() {
  const searchParams = useSearchParams();
  if (searchParams.get("reset") !== "done") {
    return null;
  }
  return (
    <p role="status" className="text-sm">
      Your new password is saved, and you were logged out everywhere. Log in with the new password.
    </p>
  );
}
