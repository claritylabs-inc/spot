import { NextRequest, NextResponse } from "next/server";

// Public manufacturer-reported catalog; no VIN or customer data is sent upstream.
export async function GET(request: NextRequest) {
  const make = request.nextUrl.searchParams.get("make")?.trim();
  const year = request.nextUrl.searchParams.get("year")?.trim();
  if ((make && make.length > 100) || (year && !/^\d{4}$/.test(year)))
    return NextResponse.json({ options: [] }, { status: 400 });
  const base = "https://vpic.nhtsa.dot.gov/api/vehicles";
  const paths = make
    ? [
        year && Number(year) > 1995
          ? `GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}`
          : `GetModelsForMake/${encodeURIComponent(make)}`,
      ]
    : ["car", "truck", "multipurpose passenger vehicle", "bus"].map(
        (type) => `GetMakesForVehicleType/${encodeURIComponent(type)}`,
      );
  try {
    const responses = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(`${base}/${path}?format=json`, {
          next: { revalidate: 86400 },
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) throw new Error("Catalog unavailable");
        const data = (await response.json()) as {
          Results?: Record<string, unknown>[];
        };
        return (data.Results ?? []).flatMap((row) => {
          const label = make ? row.Model_Name : row.MakeName;
          return typeof label === "string" && label.trim()
            ? [label.trim()]
            : [];
        });
      }),
    );
    return NextResponse.json({
      options: [...new Set(responses.flat())].sort((a, b) =>
        a.localeCompare(b),
      ),
    });
  } catch {
    return NextResponse.json({ options: [] }, { status: 503 });
  }
}
