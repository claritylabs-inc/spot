import { ConvexHttpClient } from "convex/browser";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { api } from "@/convex/_generated/api";
import { NextRequest, NextResponse } from "next/server";
const allowedOrigins = new Set([
  "https://spot.insure",
  "https://www.spot.insure",
  "https://app.spot.insure",
]);
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const local =
    process.env.NODE_ENV !== "production" &&
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (
    origin &&
    origin !== request.nextUrl.origin &&
    !allowedOrigins.has(origin) &&
    !local
  )
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  const cors: Record<string, string> = origin
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : {};
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 4096)
      throw new Error("Form too large");
    const body = await request.text();
    if (body.length > 4096) throw new Error("Form too large");
    const contact = JSON.parse(body);
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const token =
      typeof contact.handoffKey === "string"
        ? contact.handoffKey
        : crypto.randomUUID().replaceAll("-", "") +
          crypto.randomUUID().replaceAll("-", "");
    const outcome = await client.action(
      api.actions.requestIntakeHandoff.create,
      {
        token,
        name: String(contact.name ?? ""),
        email: String(contact.email ?? ""),
        phone: String(contact.phone ?? ""),
      },
    );
    return NextResponse.json(
      {
        ...outcome,
        signupUrl: `${request.nextUrl.origin}/signup?intake=${encodeURIComponent(token)}`,
      },
      { headers: cors },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: getUserFacingErrorMessage(
          error,
          "Could not start your application",
        ),
      },
      { status: 400, headers: cors },
    );
  }
}
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const local =
    process.env.NODE_ENV !== "production" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (
    origin !== request.nextUrl.origin &&
    !allowedOrigins.has(origin) &&
    !local
  )
    return new NextResponse(null, { status: 403 });
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    },
  });
}
