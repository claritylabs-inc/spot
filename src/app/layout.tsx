import type { Metadata } from "next";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Spot — Know Your Coverage",
  description: "Text Spot your insurance policy. He'll tell you what it actually means.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: "'Geist', system-ui, -apple-system, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
