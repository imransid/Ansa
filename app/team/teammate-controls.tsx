"use client";

import { useActionState, useState } from "react";
import { changeTeammateRoleAction, removeTeammateAction } from "@/app/actions/team";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { OWNER_ONLY_CONTROLS } from "@/lib/team-roles";
import type { CompanyUser } from "@/services/team";

// Owner-only controls on a teammate's row of the Team page. Each asks first
// and does nothing until the owner confirms. Hiding them from members is only
// for a tidy page: services/team.ts checks the role, company and person again.

type RemoveTeammateButtonProps = {
  userId: string;
  name: string;
  emailConfirmed: boolean;
};

// Removing is destructive, so it uses the app's one confirm step.
export function RemoveTeammateButton({ userId, name, emailConfirmed }: RemoveTeammateButtonProps) {
  const question = emailConfirmed
    ? `Remove ${name}? Their open tickets go back to routing, LinkedIn profiles they connected for the Co-Founder are disconnected, and they lose access now.`
    : `Remove ${name}? They never confirmed their email, so their account is deleted and the address can be invited again.`;
  return (
    <ConfirmButton
      action={removeTeammateAction}
      fields={{ userId }}
      label="Remove"
      accessibleLabel={`Remove ${name}`}
      question={question}
      confirmLabel="Yes, remove"
      pendingLabel="Removing..."
    />
  );
}

type TeammateRoleButtonProps = {
  userId: string;
  name: string;
  role: CompanyUser["role"];
};

// The page gives this a key that changes with the role, so after a change it
// starts again closed, offering the opposite change.
export function TeammateRoleButton({ userId, name, role }: TeammateRoleButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [errors, changeAction, isChanging] = useActionState(changeTeammateRoleAction, undefined);
  const newRole = role === "owner" ? "member" : "owner";
  const question =
    newRole === "owner"
      ? `Make ${name} an owner? Owners control ${OWNER_ONLY_CONTROLS}.`
      : `Make ${name} a member? They will no longer control ${OWNER_ONLY_CONTROLS}. Invite links they created that nobody has used yet stop working, and LinkedIn profiles they connected for the Co-Founder are disconnected (posts there go out as them).`;

  if (!isConfirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setIsConfirming(true)}>
        {newRole === "owner" ? "Make owner" : "Make member"}
      </Button>
    );
  }
  return (
    <form action={changeAction} className="grid max-w-xs gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={newRole} />
      <p className="whitespace-normal text-sm">{question}</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isChanging}>
          {isChanging ? "Saving..." : newRole === "owner" ? "Yes, make owner" : "Yes, make member"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsConfirming(false)}>
          Cancel
        </Button>
      </div>
      <ErrorMessage message={errors?.message} />
    </form>
  );
}

function ErrorMessage({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className="whitespace-normal text-sm text-destructive">
      {message}
    </p>
  );
}
