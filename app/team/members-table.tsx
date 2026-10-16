import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CompanyUser } from "@/services/team";

type MembersTableProps = {
  members: CompanyUser[];
  currentUserId: string;
};

export function MembersTable({ members, currentUserId }: MembersTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id}>
            <TableCell className="font-medium">
              {member.name}
              {member.id === currentUserId && (
                <span className="text-muted-foreground"> (you)</span>
              )}
            </TableCell>
            <TableCell>{member.email}</TableCell>
            <TableCell>
              <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                {member.role}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
