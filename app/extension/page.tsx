import { Suspense } from "react";
import type { Metadata } from "next";
import { ExtensionApp } from "@/components/browser-extension/extension-app";

export const metadata: Metadata = { title: "Browser sidebar" };

export default function ExtensionPage() {
  return (
    <Suspense fallback={null}>
      <ExtensionApp />
    </Suspense>
  );
}
