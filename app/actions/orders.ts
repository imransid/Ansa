"use server";

import { revalidatePath } from "next/cache";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { changeOrderStatusForSession } from "@/services/orders";

// Thin, like every action (step 52): the service checks the person, the
// input and the rate limit. A change that worked but couldn't message the
// customer comes back as a message too (the page shows it next to the button).
export async function changeOrderStatusAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await changeOrderStatusForSession(session, { orderId: formData.get("orderId"), change: formData.get("change") });
  revalidatePath("/", "layout");
  if (!result.ok) {
    return result.errors;
  }
  return result.notice ? { message: result.notice } : undefined;
}
