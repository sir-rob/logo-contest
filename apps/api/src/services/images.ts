/**
 * Image ingest pipeline.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE IS AN ANONYMITY CONTROL, NOT A RESIZING UTILITY.
 *
 * A logo exported from a phone or a design tool arrives carrying EXIF, XMP and
 * IPTC blocks. Those routinely contain GPS coordinates, a camera serial
 * number, the software licensee's name, and an `Artist`/`Creator` tag with the
 * author's full name. Publishing such a file into an "anonymous" gallery would
 * de-anonymise the entrant to anyone who runs `exiftool` on the download.
 *
 * So: every rendition served to a member is RE-ENCODED from pixels by sharp,
 * never passed through. The original is retained for provenance but is never
 * served. See `processUpload` for the ordering guarantees.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The module is deliberately free of Firestore and firebase-admin imports so
 * it can be unit-tested against real sharp without any credentials or emulator.
 */

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  ALLOWED_MIME_TYPES,
  DISPLAY_SIZE,
  MAX_IMAGE_DIMENSION,
  MAX_UPLOAD_BYTES,
  MIN_IMAGE_DIMENSION,
  THUMB_SIZE,
  ApiError,
  type AllowedMimeType,
} from '@contest/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessedOriginal {
  bytes: Buffer;
  contentType: AllowedMimeType;
  /** File extension WITHOUT the dot, e.g. `png`. */
  ext: string;
}

export interface ProcessedImage {
  original: ProcessedOriginal;
  /** WebP, fits inside DISPLAY_SIZE². Metadata-free. */
  display: Buffer;
  /** WebP, fits inside THUMB_SIZE². Metadata-free. */
  thumb: Buffer;
  /** ORIGINAL intrinsic width, after EXIF orientation has been applied. */
  width: number;
  /** ORIGINAL intrinsic height, after EXIF orientation has been applied. */
  height: number;
  /** SHA-256 (hex) of the original bytes exactly as uploaded. */
  contentHash: string;
}

/** Quality settings. High enough that a flat-colour logo stays crisp. */
const DISPLAY_QUALITY = 82;
const THUMB_QUALITY = 78;

/** Extension to store the retained original under, keyed by sniffed type. */
const EXT_FOR_MIME: Record<AllowedMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** sharp's `metadata().format` string for each type we accept. */
const SHARP_FORMAT_FOR_MIME: Record<AllowedMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

function isAllowedMime(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Magic-byte sniffing
// ---------------------------------------------------------------------------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Identify a buffer's real type from its leading bytes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE DECLARED MIME TYPE IS WORTHLESS
 *
 * `Content-Type` on a multipart part is a free-text string chosen by the
 * client. Browsers derive it from the file extension, and an attacker just
 * types whatever they like. `evil.svg` renamed to `logo.png` arrives declared
 * as `image/png`; believing that claim is precisely how an SVG — which is
 * executable markup and an XSS vector in a gallery that inlines images —
 * would get past the allowlist that deliberately excludes it.
 *
 * We therefore never branch on the declared type. It is logged for
 * diagnostics and otherwise discarded, and every decision below is made from
 * the bytes themselves plus sharp's own decoder.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Returns the sniffed media type, including types we do NOT accept (so the
 * caller can reject them precisely), or `null` when nothing is recognised.
 */
export function sniffMimeType(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // PNG: fixed 8-byte signature.
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';

  // JPEG: SOI marker FF D8, followed by any marker (FF).
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  // GIF: "GIF87a" / "GIF89a". Not accepted, but named so the error is precise.
  if (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a') {
    return 'image/gif';
  }

  // RIFF container: "RIFF" <u32 size> "WEBP".
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }

  // PDF: "%PDF-".
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';

  // TIFF: II*\0 or MM\0*.
  const tiffHead = buf.subarray(0, 4);
  if (tiffHead.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || tiffHead.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) {
    return 'image/tiff';
  }

  // BMP: "BM".
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';

  // SVG is text, so there is no magic number — sniff the markup instead.
  // Checked last so a binary format is never mistaken for XML.
  if (looksLikeSvg(buf)) return 'image/svg+xml';

  return null;
}

/**
 * Text sniff for SVG/XML.
 *
 * SVG is the one format we must positively identify in order to reject it, so
 * this errs toward detection: leading BOM and whitespace are skipped, an XML
 * prolog or a DOCTYPE may precede the root element, and comments are common.
 */
function looksLikeSvg(buf: Buffer): boolean {
  // A generous window: prologs, DOCTYPEs and comments can push <svg> along.
  const head = buf.subarray(0, 2048).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg')) return true;
  if (head.startsWith('<?xml') || head.startsWith('<!doctype svg') || head.startsWith('<!--')) {
    return head.includes('<svg');
  }
  return false;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Validate, normalise and re-encode an uploaded image.
 *
 * Order is load-bearing:
 *   1. byte-count   — cheapest possible rejection, before sharp touches it
 *   2. magic bytes  — reject SVG/PDF/etc. before handing anything to a decoder
 *   3. sharp decode — catches truncated and malformed files
 *   4. orientation  — applied BEFORE the dimension gate, so the numbers we
 *                     check and store are the ones a human sees
 *   5. renditions   — re-encoded from pixels, metadata dropped
 *
 * @param input        raw uploaded bytes
 * @param declaredMime the client's claim; recorded for diagnostics, never trusted
 */
export async function processUpload(input: Buffer, declaredMime: string): Promise<ProcessedImage> {
  void declaredMime; // Deliberately unused: see `sniffMimeType`'s contract.

  // 1. Size. @fastify/multipart also caps this, but the cap lives in route
  //    configuration and this function is called from tests and scripts too.
  //    Defence in depth: a limit enforced in exactly one place is a limit one
  //    refactor away from not existing.
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new ApiError('SUBMISSION_TOO_LARGE');
  }
  if (input.length === 0) {
    throw new ApiError('SUBMISSION_CORRUPT_IMAGE', 'That file was empty.');
  }

  // 2. Real type, from the bytes.
  const sniffed = sniffMimeType(input);
  if (sniffed === null || !isAllowedMime(sniffed)) {
    throw new ApiError('SUBMISSION_INVALID_TYPE');
  }

  // 3. Decode. `failOn: 'error'` makes sharp reject truncated/corrupt input
  //    rather than silently returning a partial image.
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    throw new ApiError('SUBMISSION_CORRUPT_IMAGE');
  }

  // The decoder must agree with the magic bytes. A disagreement means a
  // polyglot or a container we mis-sniffed; either way, refuse it.
  if (metadata.format === undefined || metadata.format !== SHARP_FORMAT_FOR_MIME[sniffed]) {
    throw new ApiError('SUBMISSION_INVALID_TYPE');
  }

  const rawWidth = metadata.width;
  const rawHeight = metadata.height;
  if (rawWidth === undefined || rawHeight === undefined || rawWidth <= 0 || rawHeight <= 0) {
    throw new ApiError('SUBMISSION_CORRUPT_IMAGE');
  }

  // 4. EXIF orientation. Tags 5–8 transpose the image, so a 512×2000 portrait
  //    photo is stored as 2000×512 with "rotate me" in its metadata. We bake
  //    the rotation into every rendition via `.rotate()` below; the dimensions
  //    we validate and persist must therefore be the POST-rotation ones, or a
  //    perfectly valid upload would be rejected for a side it does not have.
  const orientation = metadata.orientation ?? 1;
  const transposed = orientation >= 5 && orientation <= 8;
  const width = transposed ? rawHeight : rawWidth;
  const height = transposed ? rawWidth : rawHeight;

  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    throw new ApiError('SUBMISSION_TOO_SMALL');
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new ApiError('SUBMISSION_TOO_LARGE_DIMENSIONS');
  }

  // 5. Renditions.
  let display: Buffer;
  let thumb: Buffer;
  let archival: Buffer;
  try {
    [display, thumb, archival] = await Promise.all([
      renderWebp(input, DISPLAY_SIZE, DISPLAY_QUALITY),
      renderWebp(input, THUMB_SIZE, THUMB_QUALITY),
      renderStrippedOriginal(input, sniffed),
    ]);
  } catch {
    // Metadata parsed but the pixels did not decode — a truncated file.
    throw new ApiError('SUBMISSION_CORRUPT_IMAGE');
  }

  return {
    original: {
      // NOT the raw upload. See `renderStrippedOriginal` — the bytes we retain
      // are full-resolution but metadata-free, because this object is written
      // to the bucket and raw EXIF names its author.
      bytes: archival,
      contentType: sniffed,
      ext: EXT_FOR_MIME[sniffed],
    },
    display,
    thumb,
    width,
    height,
    // Hash of the bytes AS UPLOADED — matches `storage.contentHash`. Hashing
    // the original rather than a rendition means the duplicate check is not
    // fooled by a re-encode, and stays stable if we ever retune quality.
    contentHash: createHash('sha256').update(input).digest('hex'),
  };
}

/**
 * Re-encode to WebP at most `size` on the long edge.
 *
 * ANONYMITY-CRITICAL DETAILS, each deliberate:
 *
 *  • `.rotate()` with no argument applies the EXIF orientation tag and then
 *    discards it, so the pixels are upright and no orientation metadata rides
 *    along into the output.
 *
 *  • We never call `withMetadata()`, `keepMetadata()`, `keepExif()`,
 *    `keepXmp()` or `keepIccProfile()`. sharp's DEFAULT is to drop EXIF, XMP,
 *    IPTC and ICC on output, and the only way metadata survives is by opting
 *    in through one of those calls. The strip is therefore enforced by their
 *    absence — which is fragile against a well-meaning future edit, so
 *    `images.test.ts` asserts on the actual output buffers rather than
 *    trusting the library's default to stay put.
 *
 *  • No `.flatten()`. Logos are routinely transparent PNGs, and flattening
 *    onto white would wreck them on a dark background. Alpha is carried
 *    through, with `alphaQuality: 100` so the mask itself is not lossy.
 *
 *  • `withoutEnlargement` keeps a small-but-legal image at its native size
 *    rather than upscaling it into blur.
 */
async function renderWebp(input: Buffer, size: number, quality: number): Promise<Buffer> {
  return sharp(input, { failOn: 'error' })
    .rotate()
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, alphaQuality: 100, effort: 4 })
    .toBuffer();
}

/**
 * The full-resolution copy we RETAIN, in its uploaded format but stripped of
 * metadata.
 *
 * Why this exists: the archival object is written to the bucket, and a raw
 * camera/editor original routinely carries the author's name, their email, the
 * software licence holder and sometimes GPS coordinates in EXIF. Keeping the
 * upload byte-for-byte would mean the one object nobody looks at is the one
 * object that names everybody — an anonymity hole that no amount of care in
 * the serving path can close, because the leak is sitting in the bucket.
 *
 * It is deliberately NOT resized: this is the high-fidelity copy kept for
 * reprocessing and for handing the winning artwork to whoever prints the
 * shirt. Only the metadata goes.
 *
 * The re-encode is near-lossless and format-preserving. The duplicate-detection
 * hash is still taken over the bytes AS UPLOADED, not over this — so stripping
 * here cannot change which uploads are considered identical.
 */
async function renderStrippedOriginal(input: Buffer, mime: AllowedMimeType): Promise<Buffer> {
  // `.rotate()` bakes in EXIF orientation before the tag is discarded, exactly
  // as the renditions do — otherwise the archival copy would be the only asset
  // whose pixels sit the wrong way up.
  const pipeline = sharp(input, { failOn: 'error' }).rotate();

  switch (mime) {
    case 'image/png':
      // Lossless: identical pixels, no metadata.
      return pipeline.png({ compressionLevel: 9 }).toBuffer();
    case 'image/webp':
      return pipeline.webp({ lossless: true, effort: 4 }).toBuffer();
    case 'image/jpeg':
      // JPEG cannot be re-encoded losslessly. Quality 97 with 4:4:4 chroma is
      // visually indistinguishable and still far better than the 1600px WebP
      // display rendition, which is what this copy exists to out-resolve.
      return pipeline.jpeg({ quality: 97, chromaSubsampling: '4:4:4' }).toBuffer();
  }
}
