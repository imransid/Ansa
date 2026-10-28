import { LocalDateTime } from "@/components/local-date-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CompanyUser } from "@/services/team";

// People an owner removed from the team, most recent first.
export function RemovedMembersTable({ members }: { members: CompanyUser[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Removed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id}>
            <TableCell className="font-medium">{member.name}</TableCell>
            <TableCell>{member.email}</TableCell>
            <TableCell>{member.removedAt && <LocalDateTime iso={member.removedAt.toISOString()} />}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
