/**
 * ADVERSARIAL SUITE — GUARANTEE D: stored images carry no identifying metadata.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 01-SPEC.md §4 and §6: uploaded images are "stripped of metadata and stored
 * under opaque UUIDs".
 *
 * THESE TESTS ASSERT ON OUTPUT BYTES. That is the whole point, and it is worth
 * being explicit about why the obvious alternative is worthless:
 *
 *   A test that spies on sharp and checks `withMetadata()` was never called
 *   would PASS today and would keep passing after somebody adds
 *   `.keepMetadata()` or `.keepExif()` — different method names, same
 *   catastrophe. sharp strips metadata BY DEFAULT, so the guarantee currently
 *   rests entirely on nobody ever opting back in. A mock-based test cannot
 *   see that happen. Scanning the bytes can.
 *
 * So each test below plants real identifying EXIF — an Artist, an email in the
 * ImageDescription, a camera make and model, GPS — pushes the file through the
 * real `processUpload`, and then reads the OUTPUT back with a fresh sharp
 * instance and greps the raw buffer.
 *
 * Ported from `scripts/verify-exif-strip.ts`, which does this end-to-end but
 * only when somebody remembers to run it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { processUpload } from '../services/images.js';
import { newStoragePrefix, renditionPath } from '../services/storage.js';

// ---------------------------------------------------------------------------
// The identities planted in the test images
// ---------------------------------------------------------------------------

const ARTIST = 'Saurabh Malhotra';
const COPYRIGHT = 'Saurabh Malhotra 2026';
const CAMERA_MAKE = 'Canon';
const CAMERA_MODEL = 'EOS R5';
const SOFTWARE = 'Adobe Photoshop 2026';
const DESCRIPTION_EMAIL = 'saurabhma@google.com';

/** Every string that must not survive the pipeline. */
const PLANTED = [ARTIST, COPYRIGHT, CAMERA_MAKE, CAMERA_MODEL, SOFTWARE, DESCRIPTION_EMAIL];

/**
 * A JPEG deliberately stuffed with the EXIF fields that actually
 * de-anonymise someone.
 */
async function jpegWithIdentifyingExif(): Promise<Buffer> {
  // sharp's `Exif` TypeScript type only declares the IFD0/IFD1/... keys, but
  // libvips accepts a `GPS` block at runtime and GPS coordinates are one of
  // the most directly de-anonymising things a photo can carry. The cast keeps
  // the block in the fixture rather than dropping it to satisfy the typings.
  const metadata = {
    exif: {
      IFD0: {
        Artist: ARTIST,
        Copyright: COPYRIGHT,
        Make: CAMERA_MAKE,
        Model: CAMERA_MODEL,
        Software: SOFTWARE,
        ImageDescription: `logo draft by ${DESCRIPTION_EMAIL}`,
      },
      GPS: {
        GPSLatitudeRef: 'N',
        GPSLongitudeRef: 'W',
      },
    },
  } as unknown as Parameters<sharp.Sharp['withMetadata']>[0];

  return sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .withMetadata(metadata)
    .jpeg()
    .toBuffer();
}

/** A PNG carrying an iTXt/tEXt comment — the PNG equivalent of the above. */
async function pngWithTextMetadata(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .withMetadata({ exif: { IFD0: { Artist: ARTIST, Copyright: COPYRIGHT } } })
    .png()
    .toBuffer();
}

/** Every rendition `processUpload` produces, as raw buffers. */
async function renditionsOf(input: Buffer, mime: 'image/jpeg' | 'image/png'): Promise<Array<[string, Buffer]>> {
  const out = await processUpload(input, mime);
  return [
    ['display', out.display],
    ['thumb', out.thumb],
    // The archival original is never served, but it is still STORED, and a
    // bucket copy with the uploader's name in it is a leak waiting for the
    // first person who gets read access to the bucket.
    ['original', out.original.bytes],
  ];
}

// ===========================================================================
// D13 — EXIF and XMP absent from display, thumb AND the archival original
// ===========================================================================

describe('D13 — identifying metadata does not survive processUpload', () => {
  it('the test fixture really does carry the metadata (else the rest proves nothing)', async () => {
    const input = await jpegWithIdentifyingExif();
    const meta = await sharp(input).metadata();
    expect(meta.exif, 'could not build a JPEG with EXIF — the suite would be vacuous').toBeTruthy();

    const raw = input.toString('binary');
    // Every planted string must be findable in the INPUT, or the output scan
    // below is just asserting that a string was never there to begin with.
    for (const planted of PLANTED) {
      expect(raw, `"${planted}" was not actually planted in the input`).toContain(planted);
    }
  });

  it('no rendition carries an EXIF or XMP block', async () => {
    for (const [name, buffer] of await renditionsOf(await jpegWithIdentifyingExif(), 'image/jpeg')) {
      const meta = await sharp(buffer).metadata();
      expect(meta.exif, `${name}: EXIF block still present`).toBeFalsy();
      expect(meta.xmp, `${name}: XMP block still present`).toBeFalsy();
      expect(meta.iptc, `${name}: IPTC block still present`).toBeFalsy();
    }
  });

  it('no rendition contains any planted string in its RAW BYTES', async () => {
    // The assertion that actually matters. `sharp().metadata()` reporting no
    // EXIF is necessary but not sufficient — a string can survive in a
    // comment segment, an unparsed APPn marker or a PNG text chunk that
    // `metadata()` does not surface.
    for (const [name, buffer] of await renditionsOf(await jpegWithIdentifyingExif(), 'image/jpeg')) {
      const raw = buffer.toString('binary');
      for (const planted of PLANTED) {
        expect(raw, `${name}: leaked "${planted}" in its bytes`).not.toContain(planted);
      }
      // Nothing email-shaped at all, planted or otherwise.
      expect(raw, `${name}: contains an email address`).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      // No GPS tag names either.
      expect(raw, `${name}: contains a GPS tag`).not.toContain('GPSLatitude');
    }
  });

  it('holds for PNG input too, not just JPEG', async () => {
    for (const [name, buffer] of await renditionsOf(await pngWithTextMetadata(), 'image/png')) {
      const meta = await sharp(buffer).metadata();
      expect(meta.exif, `${name}: EXIF block still present`).toBeFalsy();
      const raw = buffer.toString('binary');
      for (const planted of [ARTIST, COPYRIGHT]) {
        expect(raw, `${name}: leaked "${planted}"`).not.toContain(planted);
      }
    }
  });

  it('the renditions are real images, so the strip is not just "produced nothing"', async () => {
    // A pipeline that silently returned an empty buffer would pass every
    // assertion above for entirely the wrong reason.
    for (const [name, buffer] of await renditionsOf(await jpegWithIdentifyingExif(), 'image/jpeg')) {
      expect(buffer.length, `${name} is empty`).toBeGreaterThan(100);
      const meta = await sharp(buffer).metadata();
      expect(meta.width, `${name} has no width`).toBeGreaterThan(0);
      expect(meta.height, `${name} has no height`).toBeGreaterThan(0);
    }
  });

  it('the display and thumb renditions are re-encoded from pixels, never passed through', async () => {
    const input = await jpegWithIdentifyingExif();
    const out = await processUpload(input, 'image/jpeg');

    // Both served renditions are WebP regardless of what came in — proof they
    // were decoded and re-encoded rather than copied.
    expect((await sharp(out.display).metadata()).format).toBe('webp');
    expect((await sharp(out.thumb).metadata()).format).toBe('webp');
    expect(out.display.equals(input)).toBe(false);
    expect(out.thumb.equals(input)).toBe(false);
  });

  it('the archival original is re-encoded as well — it is NOT the uploaded file', async () => {
    // This is the one most likely to be got wrong, because "keep the original
    // for audit" reads like "store the bytes we were given".
    const input = await jpegWithIdentifyingExif();
    const out = await processUpload(input, 'image/jpeg');
    expect(out.original.bytes.equals(input), 'the uploaded bytes were stored verbatim, EXIF and all').toBe(false);
  });

  it('a second upload of the same image is still clean (no caching shortcut)', async () => {
    const input = await jpegWithIdentifyingExif();
    await processUpload(input, 'image/jpeg');
    const second = await processUpload(input, 'image/jpeg');
    for (const [name, buffer] of [
      ['display', second.display],
      ['thumb', second.thumb],
      ['original', second.original.bytes],
    ] as const) {
      expect(buffer.toString('binary'), `${name} leaked on the second pass`).not.toContain(ARTIST);
    }
  });
});

// ===========================================================================
// D14 — stored object paths are opaque
// ===========================================================================

describe('D14 — storage paths are opaque UUIDs naming nobody', () => {
  const IDENTITIES = ['sam.rivera', 'sam.rivera@google.com', 'u-sam-1', 'Sam Rivera', 'saurabhma'];

  it('a fresh prefix is contest id + UUID and nothing else', () => {
    const prefix = newStoragePrefix('north7');
    expect(prefix).toMatch(
      /^submissions\/north7\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('prefixes are unique per call, so a replacement cannot be correlated with the original', () => {
    const prefixes = new Set(Array.from({ length: 200 }, () => newStoragePrefix('north7')));
    expect(prefixes.size).toBe(200);
  });

  it('no generated path contains a uid, an email or a name', () => {
    for (let i = 0; i < 50; i += 1) {
      const prefix = newStoragePrefix('north7');
      for (const name of ['thumb', 'display'] as const) {
        const path = renditionPath(prefix, name);
        for (const identity of IDENTITIES) {
          expect(path.toLowerCase(), `path ${path} contains ${identity}`).not.toContain(identity.toLowerCase());
        }
        expect(path).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      }
    }
  });

  it('the path is not derived from anything the uploader supplies', () => {
    // `newStoragePrefix` takes only a contest id. There is no parameter it
    // could thread a filename, a title or an uploader through, so a
    // "helpfully" descriptive object name cannot be introduced by accident.
    expect(newStoragePrefix.length).toBe(1);

    const a = newStoragePrefix('north7');
    const b = newStoragePrefix('north7');
    expect(a).not.toBe(b);
  });

  it('rendition filenames are fixed, carrying no original filename', () => {
    const prefix = newStoragePrefix('north7');
    expect(renditionPath(prefix, 'thumb')).toBe(`${prefix}/thumb.webp`);
    expect(renditionPath(prefix, 'display')).toBe(`${prefix}/display.webp`);
  });
});
