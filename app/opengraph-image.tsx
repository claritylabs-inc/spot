import { createSpotSocialImage } from "@/lib/spot-social-image";

export const alt = "Spot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type LoadedFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500;
  style: "normal";
};

async function loadGeistFonts(): Promise<LoadedFont[] | undefined> {
  const urls: Array<{ url: string; weight: 400 | 500 }> = [
    {
      url: "https://github.com/vercel/geist-font/raw/main/packages/next/dist/fonts/geist-sans/Geist-Regular.otf",
      weight: 400,
    },
    {
      url: "https://github.com/vercel/geist-font/raw/main/packages/next/dist/fonts/geist-sans/Geist-Medium.otf",
      weight: 500,
    },
  ];
  try {
    const buffers = await Promise.all(
      urls.map(async ({ url, weight }) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
        const data = await res.arrayBuffer();
        return { name: "Geist", data, weight, style: "normal" as const };
      }),
    );
    return buffers;
  } catch {
    return undefined;
  }
}

export async function ogFonts(): Promise<LoadedFont[] | undefined> {
  return loadGeistFonts();
}

export default function Image() {
  return createSpotSocialImage();
}
