"use server";

import { revalidatePath } from "next/cache";
import { changeOrderStatusThroughCore } from "@/lib/core-views/orders";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action (step 52): core checks the person, the
// input and the rate limit. A change that worked but couldn't message the
// customer comes back as a message too (the page shows it next to the button).
export async function changeOrderStatusAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const changed = await changeOrderStatusThroughCore(String(formData.get("orderId") ?? ""), String(formData.get("change") ?? ""));
  revalidatePath("/", "layout");
  if (!changed.ok) {
    return { message: changed.message };
  }
  return changed.notice ? { message: changed.notice } : undefined;
}
