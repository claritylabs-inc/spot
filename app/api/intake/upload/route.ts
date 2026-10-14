import { ConvexHttpClient } from "convex/browser";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

async function readUpload(request: NextRequest) {
  if (!request.body) throw new Error("Choose a file to upload");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 20 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Upload a file up to 20 MB");
    }
    chunks.push(value);
  }
  if (!size) throw new Error("Choose a non-empty file to upload");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin)
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403 },
      );
    const token = await convexAuthNextjsToken();
    if (!token)
      return NextResponse.json({ error: "Sign in to upload" }, { status: 401 });
    const requestId = request.nextUrl.searchParams.get(
      "request",
    ) as Id<"procurementRequests">;
    const category = request.nextUrl.searchParams.get("category");
    if (
      !requestId ||
      !["requirements", "policy", "loss_runs", "supporting"].includes(
        category ?? "",
      )
    )
      throw new Error("Invalid upload target");
    const length = Number(request.headers.get("content-length"));
    if (length > 20 * 1024 * 1024) throw new Error("Upload a file up to 20 MB");
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    client.setAuth(token);
    const grant = await client.mutation(api.requestIntake.uploadUrl, {
      requestId,
    });
    const bytes = await readUpload(request);
    if (bytes.byteLength > 20 * 1024 * 1024)
      throw new Error("Upload a file up to 20 MB");
    const uploaded = await fetch(grant.url, {
      method: "POST",
      headers: {
        "Content-Type":
          request.headers.get("content-type") ?? "application/octet-stream",
      },
      body: bytes,
      signal: AbortSignal.timeout(30000),
    });
    if (!uploaded.ok) throw new Error("Upload failed. Please retry.");
    const { storageId } = await uploaded.json();
    const id = await client.mutation(api.requestIntake.attachFile, {
      requestId,
      intentId: grant.intentId,
      fileId: storageId,
      name: decodeURIComponent(
        request.headers.get("x-spot-filename") ?? "Document",
      ),
      category: category as
        | "requirements"
        | "policy"
        | "loss_runs"
        | "supporting",
    });
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: getUserFacingErrorMessage(error, "Could not upload") },
      { status: 400 },
    );
  }
}
