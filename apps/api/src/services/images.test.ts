/**
 * Real sharp tests for the ingest pipeline.
 *
 * Every fixture is generated in-memory by sharp itself, so the suite needs no
 * binary assets and no network. The EXIF assertions are the important ones:
 * they are the only thing standing between "we assume sharp strips metadata"
 * and "we know it does".
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { DISPLAY_SIZE, MIN_IMAGE_DIMENSION, THUMB_SIZE } from '@contest/shared';
import { processUpload, sniffMimeType } from './images.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface MakeOptions {
  width: number;
  height: number;
  /** 0 = fully transparent, 255 = opaque. */
  alpha?: number;
}

function canvas({ width, height, alpha = 255 }: MakeOptions): sharp.Sharp {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 12, g: 140, b: 233, alpha: alpha / 255 },
    },
  });
}

const makePng = (o: MakeOptions): Promise<Buffer> => canvas(o).png().toBuffer();
const makeJpeg = (o: MakeOptions): Promise<Buffer> => canvas(o).jpeg({ quality: 90 }).toBuffer();
const makeWebp = (o: MakeOptions): Promise<Buffer> => canvas(o).webp().toBuffer();

/**
 * A JPEG carrying a real EXIF block with an identifying Artist tag and a GPS
 * marker — precisely the payload the strip exists to remove.
 */
async function makeJpegWithExif(o: MakeOptions): Promise<Buffer> {
  return canvas(o)
    .withMetadata({
      exif: {
        IFD0: {
          Artist: 'Sam Rivera',
          Copyright: 'Sam Rivera 2026',
          Software: 'Definitely Identifying Software 9.0',
        },
        IFD2: {
          // A GPS-ish payload; the point is that SOMETHING lands in the block.
          GPSLatitudeRef: 'N',
          GPSLongitudeRef: 'W',
        },
      },
    })
    .jpeg()
    .toBuffer();
}

const SVG_BYTES = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">' +
    '<script>alert(1)</script><rect width="1024" height="1024" fill="#0c8ce9"/></svg>',
  'utf8',
);

const PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.7\n', 'latin1'),
  Buffer.alloc(512, 0x20),
  Buffer.from('\n%%EOF\n', 'latin1'),
]);

/** Assert a thrown value is an ApiError with the expected code. */
async function expectApiError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'ApiError', code });
}

// ---------------------------------------------------------------------------
// sniffMimeType
// ---------------------------------------------------------------------------

describe('sniffMimeType', () => {
  it('identifies the three accepted formats from their magic bytes', async () => {
    expect(sniffMimeType(await makePng({ width: 600, height: 600 }))).toBe('image/png');
    expect(sniffMimeType(await makeJpeg({ width: 600, height: 600 }))).toBe('image/jpeg');
    expect(sniffMimeType(await makeWebp({ width: 600, height: 600 }))).toBe('image/webp');
  });

  it('identifies formats we reject, so the error can be precise', () => {
    expect(sniffMimeType(SVG_BYTES)).toBe('image/svg+xml');
    expect(sniffMimeType(PDF_BYTES)).toBe('application/pdf');
    expect(sniffMimeType(Buffer.from('GIF89a' + '\u0000'.repeat(32), 'latin1'))).toBe('image/gif');
  });

  it('sniffs a bare <svg> root with no XML prolog', () => {
    expect(sniffMimeType(Buffer.from('  \n<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8'))).toBe(
      'image/svg+xml',
    );
  });

  it('returns null for unrecognised and undersized buffers', () => {
    expect(sniffMimeType(Buffer.from('not an image at all, just prose', 'utf8'))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(4))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('is not fooled by a renamed file: bytes decide, not the name', async () => {
    // The exact attack: SVG bytes uploaded as "logo.png" with image/png declared.
    expect(sniffMimeType(SVG_BYTES)).not.toBe('image/png');
  });
});

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

describe('processUpload — rejections', () => {
  it('rejects an SVG even when the client declares image/png', async () => {
    await expectApiError(processUpload(SVG_BYTES, 'image/png'), 'SUBMISSION_INVALID_TYPE');
  });

  it('rejects a PDF renamed to .png', async () => {
    await expectApiError(processUpload(PDF_BYTES, 'image/png'), 'SUBMISSION_INVALID_TYPE');
  });

  it('rejects a GIF, which is a real image but not on the allowlist', async () => {
    const gif = await canvas({ width: 800, height: 800 }).gif().toBuffer();
    await expectApiError(processUpload(gif, 'image/gif'), 'SUBMISSION_INVALID_TYPE');
  });

  it('rejects an image below the minimum dimension', async () => {
    const small = await makePng({ width: MIN_IMAGE_DIMENSION - 1, height: 800 });
    await expectApiError(processUpload(small, 'image/png'), 'SUBMISSION_TOO_SMALL');
  });

  it('accepts an image exactly at the minimum dimension (boundary is inclusive)', async () => {
    const exact = await makePng({ width: MIN_IMAGE_DIMENSION, height: MIN_IMAGE_DIMENSION });
    const out = await processUpload(exact, 'image/png');
    expect(out.width).toBe(MIN_IMAGE_DIMENSION);
  });

  it('rejects an image beyond the maximum dimension', async () => {
    // 6001 on one side, kept cheap by making the other side short.
    const huge = await makePng({ width: 6001, height: 600 });
    await expectApiError(processUpload(huge, 'image/png'), 'SUBMISSION_TOO_LARGE_DIMENSIONS');
  });

  it('rejects corrupt bytes that claim to be a PNG', async () => {
    const real = await makePng({ width: 800, height: 800 });
    // Keep the signature, destroy the body: sniffing passes, decoding must not.
    const corrupt = Buffer.concat([real.subarray(0, 16), Buffer.alloc(2048, 0x7f)]);
    await expectApiError(processUpload(corrupt, 'image/png'), 'SUBMISSION_CORRUPT_IMAGE');
  });

  it('rejects a truncated JPEG', async () => {
    const real = await makeJpeg({ width: 1000, height: 1000 });
    await expectApiError(processUpload(real.subarray(0, 200), 'image/jpeg'), 'SUBMISSION_CORRUPT_IMAGE');
  });

  it('rejects an empty buffer', async () => {
    await expectApiError(processUpload(Buffer.alloc(0), 'image/png'), 'SUBMISSION_CORRUPT_IMAGE');
  });

  it('rejects a buffer over the byte cap before decoding it', async () => {
    // Over 10 MB of PNG-signed noise. Size is checked first, so this never
    // reaches sharp — which is the point of checking size first.
    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(10 * 1024 * 1024 + 1, 0x00),
    ]);
    await expectApiError(processUpload(oversized, 'image/png'), 'SUBMISSION_TOO_LARGE');
  });
});

// ---------------------------------------------------------------------------
// Renditions
// ---------------------------------------------------------------------------

describe('processUpload — renditions', () => {
  it('produces WebP renditions bounded by DISPLAY_SIZE and THUMB_SIZE', async () => {
    const input = await makePng({ width: 4000, height: 2000 });
    const out = await processUpload(input, 'image/png');

    const display = await sharp(out.display).metadata();
    const thumb = await sharp(out.thumb).metadata();

    expect(display.format).toBe('webp');
    expect(thumb.format).toBe('webp');

    // fit: 'inside' — the long edge lands exactly on the bound, aspect kept.
    expect(display.width).toBe(DISPLAY_SIZE);
    expect(display.height).toBe(DISPLAY_SIZE / 2);
    expect(thumb.width).toBe(THUMB_SIZE);
    expect(thumb.height).toBe(THUMB_SIZE / 2);
  });

  it('reports the ORIGINAL intrinsic dimensions, not the rendition ones', async () => {
    const out = await processUpload(await makePng({ width: 4000, height: 2000 }), 'image/png');
    expect(out.width).toBe(4000);
    expect(out.height).toBe(2000);
  });

  it('does not enlarge an image smaller than the rendition bounds', async () => {
    const input = await makePng({ width: 600, height: 600 });
    const out = await processUpload(input, 'image/png');

    const display = await sharp(out.display).metadata();
    const thumb = await sharp(out.thumb).metadata();

    // withoutEnlargement: display stays 600, thumb still shrinks to 640-bound.
    expect(display.width).toBe(600);
    expect(display.height).toBe(600);
    expect(thumb.width).toBe(600);
  });

  it('preserves alpha — a transparent logo must not be flattened onto white', async () => {
    const transparent = await makePng({ width: 1000, height: 1000, alpha: 0 });
    const out = await processUpload(transparent, 'image/png');

    for (const buf of [out.display, out.thumb]) {
      const meta = await sharp(buf).metadata();
      expect(meta.hasAlpha).toBe(true);

      // Sample an actual pixel: if it were flattened it would be opaque white.
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(4);
      const alphaByte = data[3];
      expect(alphaByte).toBeLessThan(16);
    }
  });

  it('retains the original bytes and the right extension for each format', async () => {
    const png = await processUpload(await makePng({ width: 800, height: 800 }), 'application/octet-stream');
    expect(png.original.contentType).toBe('image/png');
    expect(png.original.ext).toBe('png');

    const jpeg = await processUpload(await makeJpeg({ width: 800, height: 800 }), 'application/octet-stream');
    expect(jpeg.original.contentType).toBe('image/jpeg');
    expect(jpeg.original.ext).toBe('jpg');

    const webp = await processUpload(await makeWebp({ width: 800, height: 800 }), 'application/octet-stream');
    expect(webp.original.contentType).toBe('image/webp');
    expect(webp.original.ext).toBe('webp');
  });

  it('ignores the declared MIME type entirely', async () => {
    const png = await makePng({ width: 800, height: 800 });
    const lying = await processUpload(png, 'application/x-shockwave-flash');
    const honest = await processUpload(png, 'image/png');
    expect(lying.original.contentType).toBe('image/png');
    expect(lying.contentHash).toBe(honest.contentHash);
  });
});

// ---------------------------------------------------------------------------
// contentHash
// ---------------------------------------------------------------------------

describe('processUpload — contentHash', () => {
  it('is a stable SHA-256 of the original bytes', async () => {
    const input = await makePng({ width: 800, height: 800 });
    const a = await processUpload(input, 'image/png');
    const b = await processUpload(Buffer.from(input), 'image/png');

    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.contentHash).toBe(b.contentHash);

    // Matches a plain SHA-256 of the upload — same value `storage.contentHash`
    // would produce, so duplicate detection can compare across both.
    const { createHash } = await import('node:crypto');
    expect(a.contentHash).toBe(createHash('sha256').update(input).digest('hex'));
  });

  it('differs for different images', async () => {
    const a = await processUpload(await makePng({ width: 800, height: 800 }), 'image/png');
    const b = await processUpload(await makePng({ width: 800, height: 801 }), 'image/png');
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

// ---------------------------------------------------------------------------
// THE ANONYMITY ASSERTIONS
// ---------------------------------------------------------------------------

describe('processUpload — metadata stripping (anonymity control)', () => {
  it('the EXIF fixture really does carry EXIF, or the next test proves nothing', async () => {
    const withExif = await makeJpegWithExif({ width: 1200, height: 900 });
    const meta = await sharp(withExif).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.exif?.length ?? 0).toBeGreaterThan(0);
    // The identifying string is genuinely in there.
    expect(meta.exif?.toString('latin1')).toContain('Sam Rivera');
  });

  it('strips EXIF, XMP, IPTC and ICC from BOTH renditions', async () => {
    const withExif = await makeJpegWithExif({ width: 1200, height: 900 });
    const out = await processUpload(withExif, 'image/jpeg');

    for (const [name, buf] of [
      ['display', out.display],
      ['thumb', out.thumb],
    ] as const) {
      const meta = await sharp(buf).metadata();
      expect(meta.exif, `${name} must carry no EXIF`).toBeUndefined();
      expect(meta.xmp, `${name} must carry no XMP`).toBeUndefined();
      expect(meta.iptc, `${name} must carry no IPTC`).toBeUndefined();
      expect(meta.icc, `${name} must carry no ICC profile`).toBeUndefined();
    }
  });

  it('leaves no identifying string anywhere in the rendition bytes', async () => {
    // Belt and braces: even if some future metadata container escaped the
    // structured check above, the author's name must not survive as bytes.
    const withExif = await makeJpegWithExif({ width: 1200, height: 900 });
    const out = await processUpload(withExif, 'image/jpeg');

    for (const buf of [out.display, out.thumb]) {
      const asText = buf.toString('latin1');
      expect(asText).not.toContain('Sam Rivera');
      expect(asText).not.toContain('Definitely Identifying Software');
      expect(asText).not.toContain('Exif');
    }
  });

  it('the retained ORIGINAL is stripped too — "never served" is not a guarantee', async () => {
    // This assertion was previously INVERTED: it required the archival copy to
    // KEEP its EXIF, on the reasoning that no member URL points at that path.
    //
    // That reasoning does not hold. "Nothing serves it" is a property of
    // today's routing, not a durable guarantee — one future signed URL over
    // `originalPath`, one admin browsing the bucket, one support export, and
    // the object hands over the author's name, email and GPS. The anonymity
    // model in 01-SPEC.md is architectural precisely so it does not depend on
    // every future change remembering which path is safe.
    //
    // Provenance is preserved where it belongs: `ownerUid` on the Firestore
    // document, readable only through the audited moderation view. It does not
    // need to be duplicated inside image bytes.
    const withExif = await makeJpegWithExif({ width: 1200, height: 900 });
    const out = await processUpload(withExif, 'image/jpeg');

    const meta = await sharp(out.original.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();

    const asText = out.original.bytes.toString('latin1');
    expect(asText).not.toContain('Sam Rivera');
    expect(asText).not.toContain('Definitely Identifying Software');
  });

  it('the retained ORIGINAL keeps full resolution — only metadata is dropped', async () => {
    // The archival copy exists to out-resolve the 1600px display rendition
    // (it is what gets handed to whoever prints the shirt), so stripping
    // metadata must not quietly turn it into a resized copy.
    const withExif = await makeJpegWithExif({ width: 2400, height: 1800 });
    const out = await processUpload(withExif, 'image/jpeg');

    const meta = await sharp(out.original.bytes).metadata();
    expect(meta.width).toBe(2400);
    expect(meta.height).toBe(1800);
    expect(meta.format).toBe('jpeg');
  });

  it('duplicate detection still hashes the bytes AS UPLOADED, not the stripped copy', async () => {
    // Two uploads of the same artwork differing only in EXIF are different
    // uploads, and the hash must reflect what was actually sent. Hashing the
    // stripped copy instead would silently collapse them.
    const a = await makeJpegWithExif({ width: 1200, height: 900 });
    const outA = await processUpload(a, 'image/jpeg');

    const expected = createHash('sha256').update(a).digest('hex');
    expect(outA.contentHash).toBe(expected);
    expect(outA.contentHash).not.toBe(
      createHash('sha256').update(outA.original.bytes).digest('hex'),
    );
  });

  it('applies EXIF orientation so stored dimensions are what a human sees', async () => {
    // Orientation 6 = "rotate 90° CW on display": a 1200x600 stored buffer is
    // a 600x1200 portrait image to a viewer.
    const rotated = await canvas({ width: 1200, height: 600 }).withMetadata({ orientation: 6 }).jpeg().toBuffer();

    const raw = await sharp(rotated).metadata();
    expect(raw.width).toBe(1200);
    expect(raw.height).toBe(600);
    expect(raw.orientation).toBe(6);

    const out = await processUpload(rotated, 'image/jpeg');
    expect(out.width).toBe(600);
    expect(out.height).toBe(1200);

    // The rendition pixels are rotated too, and carry no orientation tag.
    const display = await sharp(out.display).metadata();
    expect(display.height).toBeGreaterThan(display.width ?? 0);
    expect(display.orientation).toBeUndefined();
  });

  it('rejects a rotated image on its POST-rotation dimensions', async () => {
    // Stored 600x400 with orientation 6 → displays as 400x600. The 400 side is
    // below the minimum, and that is the side that must be judged.
    const rotated = await canvas({ width: 600, height: 400 }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    await expectApiError(processUpload(rotated, 'image/jpeg'), 'SUBMISSION_TOO_SMALL');
  });
});
