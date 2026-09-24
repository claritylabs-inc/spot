import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/providers";
import { AuthGuard } from "@/components/auth-guard";
import { ClientWebMcpTools } from "@/components/webmcp/client-webmcp-tools";
import { AutoSaveStatusProvider } from "@/components/ui/auto-save-status";
import { AppToaster } from "@/components/ui/toaster";
import { SmoothCornersProvider } from "@/components/ui/smooth-corners-provider";
import { BrandThemeApplier } from "@/components/brand-theme-applier";
import { getClientPortalUrl } from "@/convex/lib/domains";
import { typeStyle } from "@/lib/typography";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const redaction = localFont({
  variable: "--font-redaction",
  src: [
    {
      path: "./fonts/redaction/Redaction-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/redaction/Redaction-Italic.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "./fonts/redaction/Redaction-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
});

const redaction35 = localFont({
  variable: "--font-redaction-35",
  src: "./fonts/redaction/Redaction35-Regular.woff2",
  weight: "400",
  preload: false,
});

const redaction50 = localFont({
  variable: "--font-redaction-50",
  src: "./fonts/redaction/Redaction50-Regular.woff2",
  weight: "400",
  preload: false,
});

const redaction70 = localFont({
  variable: "--font-redaction-70",
  src: "./fonts/redaction/Redaction70-Regular.woff2",
  weight: "400",
  preload: false,
});

const redaction100 = localFont({
  variable: "--font-redaction-100",
  src: "./fonts/redaction/Redaction100-Regular.woff2",
  weight: "400",
  preload: false,
});

export const viewport: Viewport = {
  viewportFit: "cover",
};

const DEFAULT_TITLE = "Spot";
const DEFAULT_DESCRIPTION =
  "Insurance policy intelligence from Tools for Enlightenment";

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(getClientPortalUrl()),
    title: {
      default: DEFAULT_TITLE,
      template: `${DEFAULT_TITLE} - %s`,
    },
    description: DEFAULT_DESCRIPTION,
    openGraph: {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      siteName: DEFAULT_TITLE,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <link rel="llms-txt" href="/llms.txt" type="text/plain" />
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark");var b=localStorage.getItem("spot:boot-state");var s=localStorage.getItem("spot:sync-scope");if(b&&s){b=JSON.parse(b);s=JSON.parse(s);if(b&&s&&b.userId===s.userId&&b.orgId===s.orgId)window.__SPOT_BOOT__={accountKind:b.accountKind,onboardingComplete:b.onboardingComplete,membershipRole:b.membershipRole,userId:b.userId,orgId:b.orgId}}}catch(e){}})()`,
            }}
          />
        </head>
        <body
          className={`${geistSans.variable} ${geistMono.variable} ${redaction.variable} ${redaction35.variable} ${redaction50.variable} ${redaction70.variable} ${redaction100.variable} ${typeStyle("body.root")}`}
        >
          <SmoothCornersProvider />
          <ConvexClientProvider>
            <AutoSaveStatusProvider>
              <BrandThemeApplier />
              <AuthGuard>{children}</AuthGuard>
              <ClientWebMcpTools />
              <AppToaster />
            </AutoSaveStatusProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
