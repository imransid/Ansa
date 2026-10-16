import { revokeInviteAction } from "@/app/actions/invites";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUtcDateTime } from "@/lib/format-date";
import type { PendingInvite } from "@/services/team";

type PendingInvitesTableProps = {
  invites: PendingInvite[];
};

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
          <TableHead>Expires (UTC)</TableHead>
          <TableHead />
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
            <TableCell>{formatUtcDateTime(invite.expiresAt)}</TableCell>
            <TableCell className="text-right">
              <form action={revokeInviteAction}>
                <input type="hidden" name="inviteId" value={invite.id} />
                <Button type="submit" variant="outline" size="sm">
                  Revoke
                </Button>
              </form>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
