import { describe, it, expect } from "vitest";
import { detectContentType, sanitizeImage } from "../src/lib/image-sanitize";

// #117 — WebP/PNG metadata stripping + malformed-JPEG fail-closed (pure byte-level; no DB).
const s = (str: string): number[] => [...str].map((c) => c.charCodeAt(0));
const u32be = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
const u32le = (n: number): number[] => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
];
const text = (b: Uint8Array): string => String.fromCharCode(...b);

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...s(type), ...data, 0, 0, 0, 0]; // dummy CRC (stripper doesn't check)
}
function buildPng(extra: number[]): Uint8Array {
  return Uint8Array.from([
    ...PNG_SIG,
    ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...extra,
    ...pngChunk("IEND", []),
  ]);
}

function webpChunk(fourcc: string, data: number[]): number[] {
  const pad = data.length & 1 ? [0] : [];
  return [...s(fourcc), ...u32le(data.length), ...data, ...pad];
}
function buildWebp(chunks: number[]): Uint8Array {
  const body = [...s("WEBP"), ...chunks];
  return Uint8Array.from([...s("RIFF"), ...u32le(body.length), ...body]);
}

describe("detectContentType", () => {
  it("recognizes PNG and WebP by magic bytes", () => {
    expect(detectContentType(buildPng([]))).toBe("image/png");
    expect(detectContentType(buildWebp([...webpChunk("VP8 ", [1, 2, 3])]))).toBe("image/webp");
  });
});

describe("sanitizeImage — PNG", () => {
  it("strips eXIf/tEXt metadata chunks, keeps IHDR/IEND", () => {
    const png = buildPng([
      ...pngChunk("eXIf", s("GPSFAKE-53.1")),
      ...pngChunk("tEXt", s("CommentGPSFAKE")),
    ]);
    const { sanitized } = sanitizeImage("image/png", png);
    const out = text(sanitized);
    expect(out.includes("GPSFAKE")).toBe(false);
    expect(sanitized[0]).toBe(0x89); // still a PNG
    expect(out.includes("IHDR")).toBe(true);
    expect(out.includes("IEND")).toBe(true);
  });
});

describe("sanitizeImage — WebP", () => {
  it("strips EXIF/XMP chunks, keeps the image chunk + RIFF/WEBP header", () => {
    const webp = buildWebp([
      ...webpChunk("VP8 ", [1, 2, 3, 4]),
      ...webpChunk("EXIF", s("GPSFAKE-6.5")),
      ...webpChunk("XMP ", s("GPSFAKE-xmp")),
    ]);
    const { sanitized } = sanitizeImage("image/webp", webp);
    const out = text(sanitized);
    expect(out.includes("GPSFAKE")).toBe(false);
    expect(out.startsWith("RIFF")).toBe(true);
    expect(out.slice(8, 12)).toBe("WEBP");
    expect(out.includes("VP8 ")).toBe(true);
    // RIFF size field equals the remaining bytes after the 8-byte RIFF header.
    const declared =
      sanitized[4] | (sanitized[5] << 8) | (sanitized[6] << 16) | (sanitized[7] << 24);
    expect(declared).toBe(sanitized.length - 8);
  });
});

describe("sanitizeImage — malformed JPEG fails closed", () => {
  it("throws on a segment length that runs past EOF", () => {
    // SOI + APP1 marker with length 0xFFFF but no payload (truncated).
    const bad = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]);
    expect(() => sanitizeImage("image/jpeg", bad)).toThrow();
  });
});
