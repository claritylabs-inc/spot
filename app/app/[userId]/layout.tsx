import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upload Your Policy",
  description:
    "Securely upload your insurance policy PDF. Spot will read through it and text you a plain-English breakdown of your coverage.",
  openGraph: {
    title: "Upload Your Policy | Spot",
    description:
      "Securely upload your insurance policy PDF. Spot will read through it and text you a plain-English breakdown of your coverage.",
    type: "website",
    siteName: "Spot",
  },
  twitter: {
    card: "summary_large_image",
    title: "Upload Your Policy | Spot",
    description:
      "Securely upload your insurance policy PDF. Spot will read through it and text you a plain-English breakdown of your coverage.",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
