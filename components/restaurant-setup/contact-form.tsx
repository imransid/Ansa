"use client";

import { saveContactSectionAction } from "@/app/actions/restaurant-setup";
import { FormField } from "@/components/form-field";
import { ADDRESS_MAX_LENGTH, PUBLIC_PHONE_MAX_LENGTH } from "@/lib/restaurant-setup";
import { SectionForm, type SectionFormPlace } from "./section-form";

type ContactFormProps = {
  place: SectionFormPlace;
  backHref?: string;
  address: string;
  phone: string | null;
};

// Setup step 2 and Settings → What it knows: where customers find the place,
// and the number they may call (optional).
export function ContactForm({ place, backHref, address, phone }: ContactFormProps) {
  return (
    <SectionForm action={saveContactSectionAction} place={place} backHref={backHref}>
      {(state) => {
        const errors = state?.errors?.fieldErrors;
        const typed = state?.errors?.values;
        return (
          <>
            <FormField
              name="address"
              label="Address, or the area you serve"
              autoComplete="street-address"
              defaultValue={typed?.address ?? address}
              maxLength={ADDRESS_MAX_LENGTH}
              errors={errors?.address}
            />
            <FormField
              name="phone"
              label="Phone number for customers (optional)"
              type="tel"
              autoComplete="tel"
              required={false}
              defaultValue={typed?.phone ?? phone ?? ""}
              maxLength={PUBLIC_PHONE_MAX_LENGTH}
              errors={errors?.phone}
            />
          </>
        );
      }}
    </SectionForm>
  );
}
