"use client";
import { useParams } from "next/navigation";
import { InformationForm } from "@/components/insurance-intake/information-form";
import type { Id } from "@/convex/_generated/dataModel";
export default function InformationFormPage() {
  const { formId } = useParams<{
    formId: Id<"procurementInformationForms">;
  }>();
  return <InformationForm formId={formId} />;
}
