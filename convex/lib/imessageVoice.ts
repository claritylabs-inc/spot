"use node";

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { EnsureM4a } from "./imessageTransport/attachmentPolicy";

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

type FfmpegCore = {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
  };
  exec(...args: string[]): number;
};

let wasmBinary: Promise<Buffer> | undefined;

/**
 * `@ffmpeg/core` is an Emscripten build for browsers, so it needs a `self` and
 * `location` while it initializes and the wasm bytes handed in directly (there
 * is no fetch of a local path in Node). The globals are removed again so other
 * libraries do not mistake this Node action for a browser. Each conversion gets
 * a fresh core; ffmpeg's `main` is not safely re-entrant.
 */
async function loadFfmpegCore(): Promise<FfmpegCore> {
  const require = createRequire(import.meta.url);
  wasmBinary ??= readFile(require.resolve("@ffmpeg/core/wasm")).catch(
    (error) => {
      wasmBinary = undefined;
      throw error;
    },
  );
  const globals = globalThis as Record<string, unknown>;
  const hadSelf = "self" in globals;
  const hadLocation = "location" in globals;
  if (!hadSelf) globals.self = globalThis;
  if (!hadLocation) globals.location = { href: "file:///" };
  try {
    const createCore = require("@ffmpeg/core") as
      | ((options: { wasmBinary: Buffer }) => Promise<FfmpegCore>)
      | { default: (options: { wasmBinary: Buffer }) => Promise<FfmpegCore> };
    const factory = typeof createCore === "function" ? createCore : createCore.default;
    return await factory({ wasmBinary: await wasmBinary });
  } finally {
    if (!hadSelf) delete globals.self;
    if (!hadLocation) delete globals.location;
  }
}

/** Same contract as Spectrum's `ensureM4a`, backed by ffmpeg compiled to wasm. */
export const ensureM4aWithWasmFfmpeg: EnsureM4a = async (bytes, mimeType) => {
  if (M4A_MIME_TYPES.has(mimeType.toLowerCase()) || isM4a(bytes)) {
    return { buffer: bytes };
  }
  const core = await loadFfmpegCore();
  core.FS.writeFile("in", bytes);
  const code = core.exec("-y", "-i", "in", "-f", "ipod", "-c:a", "aac", "out.m4a");
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  return { buffer: Buffer.from(core.FS.readFile("out.m4a")) };
};
