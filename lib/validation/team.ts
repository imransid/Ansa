import { z } from "zod";
import { userRoles } from "@/db/schema";
import { formUserIdSchema } from "./control-characters";

// A user id from the Team page's forms is only a claim: the database checks
// the person is on the session's company's team (db/team-members.ts).
const teammateIdSchema = formUserIdSchema;

export const removeTeammateSchema = z.object({
  userId: teammateIdSchema,
});

export const changeTeammateRoleSchema = z.object({
  userId: teammateIdSchema,
  role: z.enum(userRoles),
});
