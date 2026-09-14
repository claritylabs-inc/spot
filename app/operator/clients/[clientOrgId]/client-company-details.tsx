"use client";

import type { Dispatch, SetStateAction } from "react";
import type { FunctionReturnType } from "convex/server";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { INDUSTRIES } from "@/convex/lib/industries";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { typeStyle } from "@/lib/typography";

type ClientSupportDetails = NonNullable<
  FunctionReturnType<typeof api.operator.getClientSupportDetails>
>;

export type OperatorClientRelatedLegalEntity = NonNullable<
  ClientSupportDetails["relatedLegalEntities"]
>[number];

const relationshipOptions = [
  { value: "current", label: "Current legal name" },
  { value: "dba", label: "Doing business as" },
  { value: "fka", label: "Formerly known as" },
  { value: "subsidiary", label: "Subsidiary" },
  { value: "parent", label: "Parent" },
  { value: "affiliate", label: "Affiliate" },
  { value: "other", label: "Other related entity" },
];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className={`mb-1.5 block text-muted-foreground ${typeStyle("caption.medium")}`}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function ClientCompanyDetails({
  industry,
  industryVertical,
  relatedLegalEntities,
  setIndustry,
  setIndustryVertical,
  setRelatedLegalEntities,
  onSaveRequested,
  onTextFocus,
  onTextBlur,
}: {
  industry: string;
  industryVertical: string;
  relatedLegalEntities: OperatorClientRelatedLegalEntity[];
  setIndustry: Dispatch<SetStateAction<string>>;
  setIndustryVertical: Dispatch<SetStateAction<string>>;
  setRelatedLegalEntities: Dispatch<
    SetStateAction<OperatorClientRelatedLegalEntity[]>
  >;
  onSaveRequested: () => void;
  onTextFocus: () => void;
  onTextBlur: () => void;
}) {
  function updateRelatedLegalEntity(
    index: number,
    patch: Partial<OperatorClientRelatedLegalEntity>,
  ) {
    setRelatedLegalEntities((current) =>
      current.map((entity, entityIndex) =>
        entityIndex === index ? { ...entity, ...patch, source: undefined } : entity,
      ),
    );
  }

  function removeRelatedLegalEntity(index: number) {
    setRelatedLegalEntities((current) =>
      current.filter((_, entityIndex) => entityIndex !== index),
    );
    onSaveRequested();
  }

  return (
    <FormSection title="Company details" divided={false}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Industry">
          <SearchableSelect
            options={INDUSTRIES.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={industry}
            onChange={(value) => {
              setIndustry(value);
              setIndustryVertical("");
              onSaveRequested();
            }}
            placeholder="Select industry"
          />
        </Field>
        <Field label="Vertical">
          <SearchableSelect
            options={
              INDUSTRIES.find((option) => option.value === industry)
                ?.verticals.map((option) => ({
                  value: option.value,
                  label: option.label,
                })) ?? []
            }
            value={industryVertical}
            onChange={(value) => {
              setIndustryVertical(value);
              onSaveRequested();
            }}
            placeholder="Select vertical"
            disabled={!industry}
          />
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className={`text-muted-foreground ${typeStyle("caption.medium")}`}>
            Legal names and related entities
          </span>
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={() =>
              setRelatedLegalEntities((current) => [
                ...current,
                { legalName: "" },
              ])
            }
          >
            <Plus className="size-3.5" />
            Add
          </PillButton>
        </div>
        {relatedLegalEntities.length === 0 ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No related legal entities listed.
          </p>
        ) : (
          <div className="space-y-2">
            {relatedLegalEntities.map((entity, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={entity.legalName}
                    onChange={(event) =>
                      updateRelatedLegalEntity(index, {
                        legalName: event.target.value,
                      })
                    }
                    onFocus={onTextFocus}
                    onBlur={onTextBlur}
                    aria-label={`Legal name ${index + 1}`}
                    placeholder="Legal entity name"
                  />
                  <SearchableSelect
                    options={relationshipOptions}
                    value={entity.relationship ?? "other"}
                    ariaLabel={`Relationship for ${entity.legalName || "legal entity"}`}
                    onChange={(relationship) => {
                      updateRelatedLegalEntity(index, {
                        relationship: relationship as OperatorClientRelatedLegalEntity["relationship"],
                      });
                      onSaveRequested();
                    }}
                    placeholder="Select relationship"
                  />
                </div>
                <PillButton
                  type="button"
                  variant="destructive"
                  size="compact"
                  iconOnly
                  label={`Remove ${entity.legalName || "legal entity"}`}
                  onClick={() => removeRelatedLegalEntity(index)}
                >
                  <Trash2 className="size-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </FormSection>
  );
}
