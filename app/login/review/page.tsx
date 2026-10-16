import { Suspense } from "react";
import type { Metadata } from "next";
import { ReviewLogin } from "@/components/review-login";

export const metadata: Metadata = { title: "Reviewer sign-in" };

export default function ReviewLoginPage() {
  return (
    <Suspense fallback={null}>
      <ReviewLogin />
    </Suspense>
  );
}
