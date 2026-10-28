import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Category, TeamCategories } from "@/services/categories";
import type { CompanyUser } from "@/services/team";
import { MemberCategories } from "./member-categories";
import { RemoveTeammateButton, TeammateRoleButton } from "./teammate-controls";

type MembersTableProps = {
  // Everyone still on the team; removed people are listed apart.
  members: CompanyUser[];
  currentUserId: string;
  // Owners get Remove and role buttons on everyone else's row.
  canManageTeam: boolean;
  teamCategories: TeamCategories;
};

export function MembersTable({ members, currentUserId, canManageTeam, teamCategories }: MembersTableProps) {
  const activeCategories = teamCategories.categories.filter((category) => !category.archived);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Handles</TableHead>
          {canManageTeam && (
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isYou={member.id === currentUserId}
            canManageTeam={canManageTeam}
            activeCategories={activeCategories}
            handledCategoryIds={teamCategories.links
              .filter((link) => link.userId === member.id)
              .map((link) => link.categoryId)}
          />
        ))}
      </TableBody>
    </Table>
  );
}

type MemberRowProps = {
  member: CompanyUser;
  isYou: boolean;
  canManageTeam: boolean;
  activeCategories: Category[];
  handledCategoryIds: string[];
};

function MemberRow({ member, isYou, canManageTeam, activeCategories, handledCategoryIds }: MemberRowProps) {
  // Nobody removes themselves or changes their own role: another owner does.
  const canChangeThisPerson = canManageTeam && !isYou;
  return (
    <TableRow>
      <TableCell className="font-medium">
        {member.name}
        {isYou && <span className="text-muted-foreground"> (you)</span>}
        {!member.emailConfirmed && (
          <Badge variant="outline" className="ml-2">
            Not confirmed yet
          </Badge>
        )}
      </TableCell>
      <TableCell>{member.email}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={member.role === "owner" ? "default" : "secondary"}>{member.role}</Badge>
          {canChangeThisPerson && member.emailConfirmed && (
            // A new key after each change closes the confirm step.
            <TeammateRoleButton key={member.role} userId={member.id} name={member.name} role={member.role} />
          )}
        </div>
      </TableCell>
      <TableCell>
        {member.emailConfirmed ? (
          <MemberCategories
            // A new key after each save closes the editor.
            key={handledCategoryIds.join(",")}
            userId={member.id}
            activeCategories={activeCategories}
            handledCategoryIds={handledCategoryIds}
            canEdit={isYou || canManageTeam}
          />
        ) : (
          // Routing and the assignee menu skip them until they confirm.
          <span className="text-sm text-muted-foreground">No tickets until they confirm their email</span>
        )}
      </TableCell>
      {canManageTeam && (
        <TableCell className="text-right">
          {canChangeThisPerson && (
            <RemoveTeammateButton userId={member.id} name={member.name} emailConfirmed={member.emailConfirmed} />
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
