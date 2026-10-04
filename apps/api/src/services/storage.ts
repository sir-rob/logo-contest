/**
 * Image storage.
 *
 * The bucket is private and stays private. Nothing is ever made public-read;
 * the API mints a short-lived signed URL per object per request. That keeps
 * entries out of search indexes and means a leaked URL expires on its own.
 *
 * Object paths are UUID-based and carry no hint of who uploaded them. A path
 * like `submissions/<contest>/<uuid>/display.webp` is safe to hand to a client
 * precisely because it is meaningless.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { SIGNED_URL_TTL_SECONDS } from '@contest/shared';
import { getConfig, type AppConfig } from '../config.js';
import { getBucket } from '../firebase.js';

export type RenditionName = 'thumb' | 'display';

/** A fresh, opaque storage prefix for one submission's renditions. */
export function newStoragePrefix(contestId: string): string {
  return `submissions/${contestId}/${randomUUID()}`;
}

export const renditionPath = (prefix: string, name: RenditionName): string => `${prefix}/${name}.webp`;

/** SHA-256 of the ORIGINAL bytes — used to spot duplicate uploads. */
export function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function uploadObject(
  path: string,
  bytes: Buffer,
  contentType: string,
  config: AppConfig = getConfig(),
): Promise<void> {
  const file = getBucket(config).file(path);
  await file.save(bytes, {
    contentType,
    resumable: false,
    metadata: {
      contentType,
      // Renditions are immutable: a replacement gets a brand-new UUID prefix.
      cacheControl: 'private, max-age=31536000, immutable',
    },
  });
}

export async function deletePrefix(prefix: string, config: AppConfig = getConfig()): Promise<void> {
  await getBucket(config).deleteFiles({ prefix: `${prefix}/`, force: true });
}

/**
 * A short-lived read URL for one object.
 *
 * Under the emulator there is no signing key, so we fall back to the
 * emulator's own media endpoint. Production always uses a V4 signed URL.
 */
export async function signedReadUrl(path: string, config: AppConfig = getConfig()): Promise<string> {
  if (config.useEmulators && config.emulators.storage) {
    const host = config.emulators.storage.startsWith('http')
      ? config.emulators.storage
      : `http://${config.emulators.storage}`;
    return `${host}/v0/b/${config.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
  }

  const [url] = await getBucket(config)
    .file(path)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    });
  return url;
}

/** Both renditions in one round trip — every gallery card needs the pair. */
export async function signedRenditionUrls(
  thumbPath: string,
  displayPath: string,
  config: AppConfig = getConfig(),
): Promise<{ thumbUrl: string; displayUrl: string }> {
  const [thumbUrl, displayUrl] = await Promise.all([
    signedReadUrl(thumbPath, config),
    signedReadUrl(displayPath, config),
  ]);
  return { thumbUrl, displayUrl };
}
