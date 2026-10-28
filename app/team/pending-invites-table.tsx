import { revokeInviteAction } from "@/app/actions/invites";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalDateTime } from "@/components/local-date-time";
import type { PendingInvite } from "@/services/team";

type PendingInvitesTableProps = {
  invites: PendingInvite[];
};

// Owners only. Revoking asks first and says when it didn't work (too many
// revokes in an hour, or the invite was used meanwhile): a link that still
// works must never look revoked.
export function PendingInvitesTable({ invites }: PendingInvitesTableProps) {
  if (invites.length === 0) {
    return <p className="text-sm text-muted-foreground">No pending invites.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invites.map((invite) => (
          <TableRow key={invite.id}>
            <TableCell>{invite.email}</TableCell>
            <TableCell>
              <Badge variant={invite.role === "owner" ? "default" : "secondary"}>
                {invite.role}
              </Badge>
            </TableCell>
            <TableCell>
              <LocalDateTime iso={invite.expiresAt.toISOString()} />
            </TableCell>
            <TableCell className="text-right">
              <ConfirmButton
                action={revokeInviteAction}
                fields={{ inviteId: invite.id }}
                label="Revoke"
                accessibleLabel={`Revoke the invite for ${invite.email}`}
                question={`Revoke the invite for ${invite.email}? Its link stops working at once.`}
                confirmLabel="Yes, revoke"
                pendingLabel="Revoking..."
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
