"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { changeOrderStatusThroughCore, type OrderNotTold } from "@/lib/core-views/orders";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action (step 52): core checks the person, the
// input and the rate limit. A refusal shows next to the button.
export async function changeOrderStatusAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const changed = await changeOrderStatusThroughCore(String(formData.get("orderId") ?? ""), String(formData.get("change") ?? ""));
  revalidatePath("/", "layout");
  if (!changed.ok) {
    return { message: changed.message };
  }
  if (changed.notTold) {
    // WHY the page's address, not the button's message: the order moved
    // on, so the pressed button is gone (the next step's button, or the
    // Finished list) and its message with it, and the owner believed the
    // customer was told. "replace": Back doesn't bring the notice back.
    // redirect() works by throwing, so it must never sit inside a try/catch.
    redirect(ordersPageAddress(changed.notTold), RedirectType.replace);
  }
  return undefined;
}

// The Orders page saying why the customer wasn't told (read back with
// ordersPageNoticeSchema, lib/validation/orders.ts).
function ordersPageAddress({ reason, number, channel }: OrderNotTold): string {
  return `/orders?${new URLSearchParams({ notTold: reason, channel, order: String(number) })}`;
}
