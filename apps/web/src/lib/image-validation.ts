/**
 * Client-side checks for a logo file, run BEFORE anything is sent.
 *
 * The server re-runs all of this — nothing here is a security control. The
 * point is latency and dignity: a person who exports a 320px PNG should be
 * told in the same second they drop it, not after a 4 MB round-trip. Every
 * rejection therefore has to say what was wrong AND what to do about it.
 *
 * Limits come from `@contest/shared` so the client and the API can never
 * disagree about what "too big" means.
 */

import {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_DIMENSION,
  MAX_UPLOAD_BYTES,
  MIN_IMAGE_DIMENSION,
  type AllowedMimeType,
} from '@contest/shared';

export interface ImageDimensions {
  width: number;
  height: number;
}

export type RejectionReason =
  | 'type'
  | 'file-too-large'
  | 'dimensions-too-small'
  | 'dimensions-too-large'
  | 'unreadable';

export interface ImageRejection {
  reason: RejectionReason;
  /** Plain-language, addressed to the person, with the fix included. */
  message: string;
}

export interface AcceptedImage {
  file: File;
  width: number;
  height: number;
  /** Object URL for the local preview. The caller owns it and must revoke it. */
  previewUrl: string;
}

export type ImageCheckResult =
  | ({ ok: true } & AcceptedImage)
  | { ok: false; rejection: ImageRejection };

/** "9.4 MB", "812 KB". Human units, because "9856231 bytes" helps nobody. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function isAllowedMimeType(type: string): type is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(type);
}

/** "PNG, JPEG or WebP" — built from the constant so it can't drift. */
export const ACCEPTED_TYPES_LABEL = 'PNG, JPEG or WebP';

/** The `accept` attribute for the file input, from the same source of truth. */
export const ACCEPT_ATTRIBUTE = ALLOWED_MIME_TYPES.join(',');

export const MAX_UPLOAD_LABEL = formatBytes(MAX_UPLOAD_BYTES);

function describeType(file: File): string {
  const mime = file.type.trim();
  if (mime === 'image/svg+xml' || /\.svg$/i.test(file.name)) return 'svg';
  if (mime) return mime;
  const ext = file.name.includes('.') ? file.name.split('.').pop() : null;
  return ext ? `.${ext.toLowerCase()}` : 'unknown';
}

function typeRejection(file: File): ImageRejection {
  const described = describeType(file);

  if (described === 'svg') {
    return {
      reason: 'type',
      message:
        'SVG files are not accepted. An SVG is executable markup, so it cannot be shown safely in a shared gallery. ' +
        `Export your logo as a PNG at ${MIN_IMAGE_DIMENSION}px or larger on the shortest side and upload that instead — ` +
        'keep the SVG, we will ask the winner for it.',
    };
  }

  if (described === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return {
      reason: 'type',
      message: `PDFs are not accepted. Export a flat ${ACCEPTED_TYPES_LABEL} image of your logo and upload that.`,
    };
  }

  return {
    reason: 'type',
    message:
      `That file is ${described === 'unknown' ? 'not an image we recognise' : described}. ` +
      `Entries must be a ${ACCEPTED_TYPES_LABEL} image.`,
  };
}

/**
 * Read the pixel dimensions in the browser.
 *
 * `createImageBitmap` is the fast path and decodes off the main thread; the
 * `<img>` fallback covers browsers that do not have it (and Safari versions
 * that have it but choke on WebP). A decode failure here is the same signal
 * the server's decoder would give: the file is not a usable image.
 */
export async function readImageDimensions(file: File): Promise<ImageDimensions> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      if (size.width > 0 && size.height > 0) return size;
    } catch {
      // Fall through to the <img> path rather than failing outright.
    }
  }

  return new Promise<ImageDimensions>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      if (size.width > 0 && size.height > 0) resolve(size);
      else reject(new Error('Image decoded to zero dimensions.'));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be decoded.'));
    };
    image.src = url;
  });
}

/**
 * Full pre-flight: type, then size, then pixels.
 *
 * Ordered cheapest-first so an obviously wrong file is rejected without a
 * decode, and so the person sees the most fundamental problem first rather
 * than a pile of simultaneous complaints.
 */
export async function checkImageFile(file: File): Promise<ImageCheckResult> {
  if (!isAllowedMimeType(file.type)) {
    return { ok: false, rejection: typeRejection(file) };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      rejection: {
        reason: 'file-too-large',
        message:
          `That file is ${formatBytes(file.size)}, and the limit is ${MAX_UPLOAD_LABEL}. ` +
          'Re-export it at a smaller pixel size, or save the JPEG at a lower quality — a logo rarely needs more than a megabyte.',
      },
    };
  }

  let dimensions: ImageDimensions;
  try {
    dimensions = await readImageDimensions(file);
  } catch {
    return {
      ok: false,
      rejection: {
        reason: 'unreadable',
        message:
          'That image could not be opened. The file may be damaged or only partly downloaded — try re-exporting it, then upload again.',
      },
    };
  }

  const { width, height } = dimensions;
  const shortest = Math.min(width, height);
  const longest = Math.max(width, height);

  if (shortest < MIN_IMAGE_DIMENSION) {
    return {
      ok: false,
      rejection: {
        reason: 'dimensions-too-small',
        message:
          `That image is ${width} × ${height} pixels. The shortest side needs to be at least ${MIN_IMAGE_DIMENSION} pixels ` +
          'so it stays sharp in the gallery. Export it larger rather than scaling this copy up.',
      },
    };
  }

  if (longest > MAX_IMAGE_DIMENSION) {
    return {
      ok: false,
      rejection: {
        reason: 'dimensions-too-large',
        message:
          `That image is ${width} × ${height} pixels. The longest side needs to be ${MAX_IMAGE_DIMENSION} pixels or fewer. ` +
          'Scale it down before uploading — the gallery never shows anything above 1600 pixels anyway.',
      },
    };
  }

  return {
    ok: true,
    file,
    width,
    height,
    previewUrl: URL.createObjectURL(file),
  };
}
