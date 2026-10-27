import type { Metadata } from "next";
import { Card, CardContent } from "@claritylabs-inc/ui/components/card";
import { typeStyle } from "@/lib/typography";
import { notFound } from "next/navigation";
import { INTAKE_TERMS_VERSION, intakeTermsForVersion, INTAKE_BASE_TERMS_URL } from "@/lib/intake-terms";

export const metadata: Metadata = { title: "Spot Terms of Service" };

export default async function IntakeTermsPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version = INTAKE_TERMS_VERSION } = await searchParams;
  const terms = intakeTermsForVersion(version);
  if (!terms) notFound();
  return (
    <main className="mx-auto min-h-dvh max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-4">
        <h1 className={typeStyle("heading.display")}>Spot Terms of Service</h1>
        <p className="text-muted-foreground">Effective {terms.effectiveDate}</p>
      </header>
      <Card>
        <CardContent className="space-y-6">
          <p className={typeStyle("body.root")}>
            Spot is a service of Tools for Enlightenment Inc. Your use of Spot is governed by the{" "}
            <a className="underline underline-offset-4" href={INTAKE_BASE_TERMS_URL}>Tools for Enlightenment Terms of Service</a>
            {" "}and the following additional terms for insurance requests.
          </p>
          <h2 className={typeStyle("heading.section")}>Authorization to represent you</h2>
          <p className={typeStyle("body.root")}>{terms.representationTerms}</p>
          <p className={typeStyle("body.root")}>
            {terms.authorityStatement}
          </p>
          {terms.signatureConsent && <>
            <h2 className={typeStyle("heading.section")}>Electronic signature</h2>
            <p className={typeStyle("body.root")}>{terms.signatureConsent}</p>
          </>}
          {terms.pdfAuthorizationTerms && <>
            <h2 className={typeStyle("heading.section")}>Authorization PDF and sharing with insurance providers</h2>
            <p className={typeStyle("body.root")}>{terms.pdfAuthorizationTerms}</p>
          </>}
        </CardContent>
      </Card>
    </main>
  );
}
