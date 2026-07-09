// Byte-level content validation + photo sanitization (#106; parent epic #12).
//
// Two jobs, both fail-safe:
//   1. detectContentType() reads magic bytes so finalize can reject MIME spoofing (a .jpg claim whose
//      bytes are actually a PDF/HTML never becomes usable evidence).
//   2. sanitizeImage() strips EXIF/GPS metadata from JPEG (preserving the capture timestamp), PNG, and
//      WebP (GDPR data-minimization, §22), and fails CLOSED on a structurally malformed image. PDFs
//      pass through. Orientation: EXIF is stripped, so images must be upright pre-upload (client
//      re-encode bakes it in, §2269); server-side rotation would need a raster codec (out of scope).

export type DetectedContentType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

function startsWith(bytes: Uint8Array, sig: number[], at = 0): boolean {
  if (bytes.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false;
  return true;
}

/**
 * Identify an allowlisted content type from the leading bytes, or null if the bytes match none. Used
 * to reject a claimed MIME that does not match the actual object contents.
 */
export function detectContentType(bytes: Uint8Array): DetectedContentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  return null;
}

/** Parse an EXIF ASCII datetime ("YYYY:MM:DD HH:MM:SS") to a Date (interpreted as UTC). Null if bad. */
function parseExifDateTime(s: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Best-effort extraction of DateTimeOriginal (tag 0x9003, in the Exif sub-IFD) or DateTime (0x0132, in
 * IFD0) from an EXIF TIFF block. `view` is positioned at the TIFF header (right after "Exif\0\0").
 * Returns null on any malformed structure - extraction is advisory, never a failure path.
 */
function extractCaptureTime(view: DataView, tiffStart: number, tiffLen: number): Date | null {
  try {
    const bo = view.getUint16(tiffStart, false);
    const little = bo === 0x4949; // 'II'
    if (!little && bo !== 0x4d4d) return null; // not 'MM' either
    const u16 = (o: number) => view.getUint16(o, little);
    const u32 = (o: number) => view.getUint32(o, little);
    const end = tiffStart + tiffLen;

    const readAscii = (valueOff: number, count: number): string => {
      let s = "";
      for (let i = 0; i < count && valueOff + i < end; i++) {
        const c = view.getUint8(valueOff + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };

    // Walk one IFD; return {found datetime} or the Exif-IFD pointer. Entries are 12 bytes.
    const walkIfd = (ifdOff: number, wantExifPtr: boolean): { dt?: string; exifPtr?: number } => {
      if (ifdOff <= 0 || tiffStart + ifdOff + 2 > end) return {};
      const base = tiffStart + ifdOff;
      const count = u16(base);
      let exifPtr: number | undefined;
      let dt: string | undefined;
      for (let i = 0; i < count; i++) {
        const e = base + 2 + i * 12;
        if (e + 12 > end) break;
        const tag = u16(e);
        const compCount = u32(e + 4);
        const valOff = e + 8;
        if (tag === 0x8769 && wantExifPtr) exifPtr = u32(valOff); // Exif sub-IFD pointer
        if (tag === 0x0132 || tag === 0x9003) {
          // ASCII datetime; if it fits in 4 bytes it's inline, else valOff holds a TIFF-relative offset.
          const strOff = compCount <= 4 ? valOff : tiffStart + u32(valOff);
          dt = readAscii(strOff, compCount);
        }
      }
      return { dt, exifPtr };
    };

    const ifd0Off = u32(tiffStart + 4);
    const ifd0 = walkIfd(ifd0Off, true);
    if (ifd0.exifPtr) {
      const exif = walkIfd(ifd0.exifPtr, false);
      if (exif.dt) return parseExifDateTime(exif.dt);
    }
    if (ifd0.dt) return parseExifDateTime(ifd0.dt);
    return null;
  } catch {
    return null;
  }
}

export interface SanitizeResult {
  sanitized: Uint8Array;
  /** Capture time recovered from EXIF before stripping, or null. */
  capturedAt: Date | null;
}

/**
 * Sanitize an uploaded image by type: strip EXIF/GPS + recover capture time for JPEG; strip metadata
 * chunks for PNG/WebP; pass PDFs through. Fails CLOSED (throws) on a structurally malformed image so a
 * corrupt/truncated upload never becomes usable evidence.
 *
 * ORIENTATION: stripping EXIF removes the Orientation tag, so images MUST already be upright before
 * upload. The client compresses/re-encodes photos before the presigned PUT (§22/§2269), which bakes in
 * the rotation; the server then strips EXIF from the already-normalized pixels. Correct server-side
 * rotation would need a raster codec (e.g. sharp) and is intentionally out of scope here.
 */
export function sanitizeImage(contentType: string, bytes: Uint8Array): SanitizeResult {
  if (contentType === "image/jpeg") return stripJpeg(bytes);
  if (contentType === "image/png") return { sanitized: stripPngMetadata(bytes), capturedAt: null };
  if (contentType === "image/webp")
    return { sanitized: stripWebpMetadata(bytes), capturedAt: null };
  return { sanitized: bytes, capturedAt: null }; // application/pdf and anything else: pass through
}

/** Strip every APP1 (EXIF/XMP) segment from a JPEG; recover capture time from the first EXIF APP1. */
function stripJpeg(bytes: Uint8Array): SanitizeResult {
  if (!startsWith(bytes, [0xff, 0xd8])) return { sanitized: bytes, capturedAt: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [0xff, 0xd8]; // SOI
  let capturedAt: Date | null = null;
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      for (let k = i; k < bytes.length; k++) out.push(bytes[k]);
      break;
    }
    const marker = bytes[i + 1];
    if (marker === 0xda) {
      // Start of Scan: the remainder is entropy-coded data + EOI. Copy verbatim.
      for (let k = i; k < bytes.length; k++) out.push(bytes[k]);
      break;
    }
    if (i + 4 > bytes.length) throw new Error("sanitizeImage: truncated JPEG segment header");
    const segLen = view.getUint16(i + 2, false); // includes the 2 length bytes
    const segStart = i + 2;
    const dataStart = segStart + 2;
    // Fail closed on a segment length that is nonsensical or runs past the end of the object.
    if (segLen < 2 || segStart + segLen > bytes.length) {
      throw new Error("sanitizeImage: malformed JPEG segment length");
    }
    if (marker === 0xe1) {
      const isExif =
        bytes[dataStart] === 0x45 && // E
        bytes[dataStart + 1] === 0x78 && // x
        bytes[dataStart + 2] === 0x69 && // i
        bytes[dataStart + 3] === 0x66 && // f
        bytes[dataStart + 4] === 0x00 &&
        bytes[dataStart + 5] === 0x00;
      if (isExif && capturedAt === null) {
        capturedAt = extractCaptureTime(view, dataStart + 6, segLen - 2 - 6);
      }
      // drop the whole APP1 (EXIF or XMP)
    } else {
      for (let k = i; k < segStart + segLen; k++) out.push(bytes[k]);
    }
    i = segStart + segLen;
  }
  return { sanitized: Uint8Array.from(out), capturedAt };
}

// PNG metadata chunks to strip (EXIF + all text + mod-time). Critical/rendering chunks are kept.
const PNG_STRIP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/** Drop EXIF/text/time chunks from a PNG (they can carry EXIF/GPS/XMP). Fails closed if malformed. */
function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!startsWith(bytes, sig)) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [...sig];
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = view.getUint32(i, false);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const chunkEnd = i + 12 + len; // length(4) + type(4) + data(len) + crc(4)
    if (chunkEnd > bytes.length) throw new Error("sanitizeImage: malformed PNG chunk length");
    if (!PNG_STRIP.has(type)) for (let k = i; k < chunkEnd; k++) out.push(bytes[k]);
    i = chunkEnd;
    if (type === "IEND") break;
  }
  return Uint8Array.from(out);
}

/** Drop EXIF/XMP chunks from a WebP RIFF container (they can carry EXIF/GPS). Fails closed if malformed. */
function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const isWebp =
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  if (!isWebp) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body: number[] = []; // chunks after the 'WEBP' fourCC
  let i = 12;
  while (i + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    const size = view.getUint32(i + 4, true); // little-endian
    const padded = size + (size & 1); // chunks are padded to an even size
    const chunkEnd = i + 8 + padded;
    if (chunkEnd > bytes.length) throw new Error("sanitizeImage: malformed WebP chunk length");
    if (fourcc !== "EXIF" && fourcc !== "XMP ")
      for (let k = i; k < chunkEnd; k++) body.push(bytes[k]);
    i = chunkEnd;
  }
  const fileSize = 4 + body.length; // 'WEBP' + remaining chunks
  return Uint8Array.from([
    0x52,
    0x49,
    0x46,
    0x46, // RIFF
    fileSize & 0xff,
    (fileSize >> 8) & 0xff,
    (fileSize >> 16) & 0xff,
    (fileSize >> 24) & 0xff,
    0x57,
    0x45,
    0x42,
    0x50, // WEBP
    ...body,
  ]);
}
