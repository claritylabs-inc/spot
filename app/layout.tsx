import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  Instrument_Serif,
  Bagel_Fat_One,
} from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

const bagelFatOne = Bagel_Fat_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bagel-fat-one",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://spot.claritylabs.inc";
const TITLE = "Spot from Clarity Labs";
const DESCRIPTION =
  "Know what your insurance actually covers. Text a photo of your policy to Spot and get a plain-English breakdown of your coverage, deductibles, and gaps in minutes. Free — no app, no account.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s | Spot",
  },
  description: DESCRIPTION,
  keywords: [
    "understand my insurance policy",
    "insurance policy explained",
    "insurance coverage breakdown",
    "insurance help",
    "renters insurance explained",
    "auto insurance coverage",
    "pet insurance explained",
    "insurance policy reader",
    "free insurance help",
  ],
  authors: [{ name: "Clarity Labs", url: "https://claritylabs.inc" }],
  creator: "Clarity Labs",
  publisher: "Clarity Labs",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Spot",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  alternates: {
    canonical: SITE_URL,
  },
  category: "insurance",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf8f4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${bagelFatOne.variable} antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
