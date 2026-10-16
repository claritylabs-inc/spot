"use node";

import { spawn } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnsureM4a } from "../../imessage-worker/src/attachmentPolicy";

const M4A_MIME_TYPES = new Set([
  "audio/mp4",
  "audio/mp4a-latm",
  "audio/x-m4a",
  "audio/aac",
  "audio/aacp",
]);
const M4A_BRANDS = new Set(["M4A ", "M4B ", "mp42", "isom", "iso2"]);

function isM4a(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    M4A_BRANDS.has(bytes.toString("ascii", 8, 12))
  );
}

let ffmpegPath: Promise<string> | undefined;

/**
 * Convex's Node runtime has no ffmpeg. `@ffmpeg-installer/ffmpeg` ships a static
 * binary through npm (no postinstall download). The deployed package directory
 * may not preserve the executable bit, so the binary is copied to /tmp once per
 * container and marked executable.
 */
function resolveFfmpeg(): Promise<string> {
  ffmpegPath ??= (async () => {
    const installed = createRequire(import.meta.url)(
      "@ffmpeg-installer/ffmpeg",
    ) as { path: string };
    const target = join(tmpdir(), "spot-ffmpeg");
    await copyFile(installed.path, target);
    await chmod(target, 0o755);
    return target;
  })().catch((error) => {
    ffmpegPath = undefined;
    throw error;
  });
  return ffmpegPath;
}

function runFfmpeg(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}: ${stderr}`)),
    );
  });
}

/** Same contract as Spectrum's `ensureM4a`, backed by the bundled ffmpeg. */
export const ensureM4aWithBundledFfmpeg: EnsureM4a = async (
  bytes,
  mimeType,
) => {
  if (M4A_MIME_TYPES.has(mimeType.toLowerCase()) || isM4a(bytes)) {
    return { buffer: bytes };
  }
  const binary = await resolveFfmpeg();
  const dir = await mkdtemp(join(tmpdir(), "spot-voice-"));
  try {
    const input = join(dir, "in");
    const output = join(dir, "out.m4a");
    await writeFile(input, bytes);
    await runFfmpeg(binary, ["-y", "-i", input, "-f", "ipod", "-c:a", "aac", output]);
    return { buffer: await readFile(output) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};
