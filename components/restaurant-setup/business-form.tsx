"use client";

import { saveBusinessSectionAction } from "@/app/actions/restaurant-setup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MIN_LENGTH } from "@/lib/form-limits";
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPES, COMPANY_KIND_LABELS, DESCRIPTION_MAX_LENGTH, type BusinessType, type CompanyKind } from "@/lib/restaurant-setup";
import { Choice, Choices } from "./assistant-settings-form";
import { FieldErrors, SectionForm, type SectionFormPlace } from "./section-form";

type BusinessFormProps = {
  place: SectionFormPlace;
  // null: not chosen yet (a new account's first setup step).
  kind: CompanyKind | null;
  companyName: string;
  businessType: BusinessType | null;
  description: string;
};

// Setup step 1 and Settings → What it knows: who ansa is for (step 50: a
// business, or just you), the name it uses, what kind of business, and what
// it serves or what you do. Picking "Just me" hides the business's fields and
// changes the labels with CSS alone (group-has): nothing for React to reset
// after the action runs, and the server reads every field by the kind sent.
export function BusinessForm({ place, kind, companyName, businessType, description }: BusinessFormProps) {
  return (
    <SectionForm action={saveBusinessSectionAction} place={place}>
      {(state) => {
        const errors = state?.errors?.fieldErrors;
        const typed = state?.errors?.values;
        const chosenKind = typed?.kind ?? kind ?? "";
        const chosenType = typed?.businessType ?? businessType ?? "";
        const forBusiness = "group-has-[#kind-personal:checked]/kind:hidden";
        const forPerson = "hidden group-has-[#kind-personal:checked]/kind:inline";
        return (
          <div className="group/kind grid gap-6">
            <Choices legend="Who is ansa for?" name="kind" errors={errors?.kind}>
              <Choice name="kind" value="business" defaultChecked={chosenKind === "business"} label={COMPANY_KIND_LABELS.business}>
                It answers your customers for your business.
              </Choice>
              <Choice name="kind" value="personal" defaultChecked={chosenKind === "personal"} label={COMPANY_KIND_LABELS.personal}>
                It answers for you while you&apos;re away, like your own assistant, and tells you what you missed.
              </Choice>
            </Choices>
            <div className="grid gap-2">
              <Label htmlFor="companyName">
                <span className={forBusiness}>Business name</span>
                <span className={forPerson}>Your name, as ansa should say it</span>
              </Label>
              <Input
                id="companyName"
                name="companyName"
                autoComplete="organization"
                defaultValue={typed?.companyName ?? companyName}
                minLength={COMPANY_NAME_MIN_LENGTH}
                maxLength={COMPANY_NAME_MAX_LENGTH}
                required
                aria-invalid={errors?.companyName ? true : undefined}
                aria-describedby={errors?.companyName ? "companyName-errors" : undefined}
              />
              <FieldErrors id="companyName-errors" errors={errors?.companyName} />
            </div>
            <div className={`grid gap-2 ${forBusiness}`}>
              <Label htmlFor="businessType">What kind of business</Label>
              <NativeSelect
                id="businessType"
                name="businessType"
                key={chosenType}
                defaultValue={chosenType}
                aria-invalid={errors?.businessType ? true : undefined}
                aria-describedby={errors?.businessType ? "businessType-errors" : undefined}
              >
                <option value="" disabled>
                  Choose one
                </option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {BUSINESS_TYPE_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
              <FieldErrors id="businessType-errors" errors={errors?.businessType} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">
                <span className={forBusiness}>What you offer, in a sentence</span>
                <span className={forPerson}>What you do, and what people usually contact you about (optional)</span>
              </Label>
              <Input
                id="description"
                name="description"
                defaultValue={typed?.description ?? description}
                maxLength={DESCRIPTION_MAX_LENGTH}
                aria-invalid={errors?.description ? true : undefined}
                aria-describedby={errors?.description ? "description-errors" : undefined}
              />
              <FieldErrors id="description-errors" errors={errors?.description} />
            </div>
          </div>
        );
      }}
    </SectionForm>
  );
}
