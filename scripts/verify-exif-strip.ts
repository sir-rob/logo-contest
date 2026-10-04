/**
 * Independent verification that the upload pipeline destroys identifying
 * image metadata.
 *
 * This is NOT a unit test of the pipeline's own making — it builds a JPEG
 * deliberately stuffed with the EXIF fields that actually de-anonymise a
 * person (artist, copyright, camera, GPS coordinates), pushes it through
 * `processUpload`, and then reads the output back with a fresh sharp instance
 * to confirm none of it survived.
 *
 * Run: npx tsx scripts/verify-exif-strip.ts
 */
import sharp from 'sharp';
import { processUpload } from '../apps/api/src/services/images.js';

const FAIL: string[] = [];
const ok = (label: string) => console.log(`  \u2713 ${label}`);
const bad = (label: string) => {
  FAIL.push(label);
  console.log(`  \u2717 ${label}`);
};

async function main(): Promise<void> {
  console.log('\nBuilding a JPEG carrying identifying metadata...');

  const withExif = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .withMetadata({
      exif: {
        IFD0: {
          Artist: 'Saurabh Malhotra',
          Copyright: 'Saurabh Malhotra 2026',
          Make: 'Canon',
          Model: 'EOS R5',
          Software: 'Adobe Photoshop 2026',
          ImageDescription: 'logo draft by saurabhma@google.com',
        },
        GPS: {
          GPSLatitudeRef: 'N',
          GPSLongitudeRef: 'W',
        },
      },
    })
    .jpeg()
    .toBuffer();

  const before = await sharp(withExif).metadata();
  console.log(`  input: ${withExif.length} bytes, exif present = ${Boolean(before.exif)}`);
  if (!before.exif) {
    console.log('\n  ! Could not construct a JPEG with EXIF — verification inconclusive.');
    process.exit(2);
  }

  // Prove the identifying strings really are in the input bytes.
  const rawBefore = withExif.toString('binary');
  const planted = ['Saurabh Malhotra', 'saurabhma@google.com', 'Canon', 'EOS R5'];
  const presentBefore = planted.filter((s) => rawBefore.includes(s));
  console.log(`  planted strings found in input: ${presentBefore.join(', ') || '(none)'}`);

  console.log('\nRunning it through processUpload()...');
  const out = await processUpload(withExif, 'image/jpeg');

  const renditions: Array<[string, Buffer]> = [];
  for (const key of ['display', 'thumb', 'original'] as const) {
    const v = (out as unknown as Record<string, unknown>)[key];
    if (Buffer.isBuffer(v)) {
      renditions.push([key, v as Buffer]);
    } else if (v && typeof v === 'object') {
      // `original` is shaped { bytes, contentType, ext } — not a bare Buffer.
      const inner = (v as Record<string, unknown>).bytes ?? (v as Record<string, unknown>).buffer;
      if (Buffer.isBuffer(inner)) renditions.push([key, inner as Buffer]);
      else bad(`${key}: could not locate its bytes — NOT VERIFIED`);
    }
  }
  if (renditions.length === 0) {
    console.log('  ! Could not locate rendition buffers on the result:', Object.keys(out));
    process.exit(2);
  }

  console.log(`\nChecking ${renditions.length} rendition(s):`);
  for (const [name, buf] of renditions) {
    const meta = await sharp(buf).metadata();
    const raw = buf.toString('binary');

    if (meta.exif) bad(`${name}: EXIF block still present`);
    else ok(`${name}: no EXIF block`);

    if (meta.xmp) bad(`${name}: XMP block still present`);
    else ok(`${name}: no XMP block`);

    if (meta.icc) console.log(`  \u00b7 ${name}: ICC profile retained (colour accuracy, not identifying)`);

    const leaked = planted.filter((s) => raw.includes(s));
    if (leaked.length > 0) bad(`${name}: identifying strings survived \u2014 ${leaked.join(', ')}`);
    else ok(`${name}: no identifying strings in raw bytes`);
  }

  console.log('');
  if (FAIL.length > 0) {
    console.log(`FAILED \u2014 ${FAIL.length} problem(s). Metadata is leaking.`);
    process.exit(1);
  }
  console.log('PASSED \u2014 no identifying metadata survives the pipeline.');
}

main().catch((err) => {
  console.error('verification error:', err);
  process.exit(2);
});
