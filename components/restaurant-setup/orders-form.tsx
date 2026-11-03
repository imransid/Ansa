"use client";

import { saveOrdersSectionAction } from "@/app/actions/restaurant-setup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { priceForEditing } from "@/lib/menu";
import { NOTE_MAX_LENGTH } from "@/lib/restaurant-setup";
import { CheckField } from "./check-field";
import { FieldErrors, FieldHint, SectionForm, type SectionFormPlace } from "./section-form";
import { TextAreaField } from "./text-area-field";

type OrdersFormProps = {
  place: SectionFormPlace;
  backHref?: string;
  takesOrders: boolean;
  delivery: boolean;
  deliveryNote: string;
  deliveryFeeCents: number;
  pickup: boolean;
  paymentNote: string;
  currency: string | null;
  // Every currency this server knows (lib/locale-options.ts).
  currencies: { code: string; label: string }[];
};

// Setup step 4 and Settings → What it knows: whether ansa takes orders, how
// they reach the customer, how they are paid, and the menu's currency.
export function OrdersForm(props: OrdersFormProps) {
  const { place, backHref, currencies } = props;
  return (
    <SectionForm action={saveOrdersSectionAction} place={place} backHref={backHref}>
      {(state) => {
        const errors = state?.errors?.fieldErrors;
        const typed = state?.errors?.values;
        const chosenCurrency = typed?.currency ?? props.currency ?? "";
        // After a refused save (core's "Choose delivery, pickup or both"), the
        // boxes as they were ticked: a ticked box sends "on", an unticked none.
        const ticked = (name: string, saved: boolean) => (typed ? typed[name] === "on" : saved);
        return (
          <>
            <div className="grid gap-4">
              <CheckField
                name="takesOrders"
                label="Take orders"
                hint="ansa takes orders from your menu in the chat, works out the total from your prices, and you accept them on the Orders page."
                defaultChecked={ticked("takesOrders", props.takesOrders)}
              />
              <CheckField name="delivery" label="Delivery" hint="You bring orders to the customer." defaultChecked={ticked("delivery", props.delivery)} />
              <CheckField name="pickup" label="Pickup" hint="Customers collect their order." defaultChecked={ticked("pickup", props.pickup)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deliveryFee">Delivery fee (optional)</Label>
              <Input
                id="deliveryFee"
                name="deliveryFee"
                inputMode="decimal"
                maxLength={30}
                placeholder="0.00"
                defaultValue={typed?.deliveryFee ?? (props.deliveryFeeCents > 0 && props.currency ? priceForEditing(props.deliveryFeeCents, props.currency) : "")}
                aria-invalid={errors?.deliveryFee ? true : undefined}
                aria-describedby={errors?.deliveryFee ? "deliveryFee-hint deliveryFee-errors" : "deliveryFee-hint"}
                className="max-w-40"
              />
              <FieldHint id="deliveryFee-hint">ansa adds it to every delivery order. Leave it empty for free delivery.</FieldHint>
              <FieldErrors id="deliveryFee-errors" errors={errors?.deliveryFee} />
            </div>
            <TextAreaField
              name="deliveryNote"
              label="About delivery (optional)"
              hint="Where you deliver and any minimum order, as you would tell a customer."
              defaultValue={typed?.deliveryNote ?? props.deliveryNote}
              maxLength={NOTE_MAX_LENGTH}
              errors={errors?.deliveryNote}
            />
            <TextAreaField
              name="paymentNote"
              label="How customers pay (optional)"
              hint="For example: cash or card on delivery. ansa takes no payments itself."
              defaultValue={typed?.paymentNote ?? props.paymentNote}
              maxLength={NOTE_MAX_LENGTH}
              errors={errors?.paymentNote}
            />
            <div className="grid gap-2">
              <Label htmlFor="currency">Currency of your prices</Label>
              <NativeSelect
                id="currency"
                name="currency"
                key={chosenCurrency}
                defaultValue={chosenCurrency}
                required
                aria-invalid={errors?.currency ? true : undefined}
                aria-describedby={errors?.currency ? "currency-hint currency-errors" : "currency-hint"}
              >
                <option value="" disabled>
                  Choose your currency
                </option>
                {currencies.map(({ code, label }) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <FieldHint id="currency-hint">Every price on your menu is in it, and ansa works out order totals in it.</FieldHint>
              <FieldErrors id="currency-errors" errors={errors?.currency} />
            </div>
          </>
        );
      }}
    </SectionForm>
  );
}
