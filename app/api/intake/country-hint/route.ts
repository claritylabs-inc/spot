import { NextRequest, NextResponse } from "next/server";
import { countryHintName } from "@/lib/country-hint";

/** Advisory country only. Never retain the IP or use this for authorization. */
export function GET(request: NextRequest) {
  const country = countryHintName(request.headers.get("x-vercel-ip-country"));
  return NextResponse.json({ country: country ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
