import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TeamCategories } from "@/services/categories";
import type { CompanyUser } from "@/services/team";
import { MemberCategories } from "./member-categories";

type MembersTableProps = {
  members: CompanyUser[];
  currentUserId: string;
  currentUserIsOwner: boolean;
  teamCategories: TeamCategories;
};

export function MembersTable({ members, currentUserId, currentUserIsOwner, teamCategories }: MembersTableProps) {
  const activeCategories = teamCategories.categories.filter((category) => !category.archived);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Handles</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const handledCategoryIds = teamCategories.links
            .filter((link) => link.userId === member.id)
            .map((link) => link.categoryId);
          return (
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
            <TableCell>
              <MemberCategories
                // A new key after each save closes the editor.
                key={handledCategoryIds.join(",")}
                userId={member.id}
                activeCategories={activeCategories}
                handledCategoryIds={handledCategoryIds}
                canEdit={member.id === currentUserId || currentUserIsOwner}
              />
            </TableCell>
          </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
