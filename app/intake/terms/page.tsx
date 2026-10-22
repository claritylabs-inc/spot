import type { Metadata } from "next";
import { Card, CardContent } from "@claritylabs-inc/ui/components/card";
import { typeStyle } from "@/lib/typography";
import { INTAKE_TERMS_VERSION, SPOT_REPRESENTATION_TERMS } from "@/lib/intake-terms";

export const metadata: Metadata = { title: "Spot Terms of Service" };

export default function IntakeTermsPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-4">
        <h1 className={typeStyle("heading.display")}>Spot Terms of Service</h1>
        <p className="text-muted-foreground">Effective {INTAKE_TERMS_VERSION}</p>
      </header>
      <Card>
        <CardContent className="space-y-6">
          <p className={typeStyle("body.root")}>
            Spot is a service of Tools for Enlightenment Inc. Your use of Spot is governed by the{" "}
            <a className="underline underline-offset-4" href="https://toolsforenlightenment.org/terms-of-service">Tools for Enlightenment Terms of Service</a>
            {" "}and the following additional terms for insurance requests.
          </p>
          <h2 className={typeStyle("heading.section")}>Authorization to represent you</h2>
          <p className={typeStyle("body.root")}>{SPOT_REPRESENTATION_TERMS}</p>
          <p className={typeStyle("body.root")}>
            By accepting these terms, you confirm that you have authority to act for the business identified in your application and to grant this authorization on its behalf.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
