import { z } from "zod";
import { newPasswordSchema, PASSWORD_MAX_LENGTH, personNameSchema } from "./auth";

// The Account page: your own name.
export const changeNameSchema = z.object({
  name: personNameSchema,
});

// The Account page: the current password proves it is you, not someone at a
// browser you left logged in.
export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Enter your current password")
    .max(PASSWORD_MAX_LENGTH, "Password is too long"),
  newPassword: newPasswordSchema,
});
