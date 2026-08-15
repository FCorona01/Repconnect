import 'server-only';

import sharp from 'sharp';
import type { OutputInfo } from 'sharp';

import type { BucketPolicy } from './policy';

/**
 * Image normalisation.
 *
 * Every accepted image is fully decoded and re-encoded to WebP. That single
 * step does four jobs at once:
 *
 *   1. VALIDATES the file — sharp refuses to decode anything that is not
 *      genuinely an image, so a renamed executable dies here even if it
 *      somehow passed the signature check.
 *   2. STRIPS ALL METADATA. sharp does not carry metadata across a re-encode
 *      unless explicitly asked to, so EXIF goes — including the GPS
 *      coordinates that phone cameras embed. A rep uploading a photo taken at
 *      home should not be publishing their home address.
 *   3. DESTROYS EMBEDDED PAYLOADS. A polyglot file that is both a valid image
 *      and a valid script does not survive being decoded to pixels and
 *      re-encoded.
 *   4. BOUNDS the output, so one upload cannot cost megabytes on every page
 *      view.
 */

export interface ProcessedImage {
  buffer: Buffer;
  contentType: 'image/webp';
  width: number;
  height: number;
}

/**
 * Guards against decompression bombs: a small file that expands into an
 * enormous bitmap and exhausts memory. Checked before any resize work.
 */
const MAX_SOURCE_PIXELS = 50_000_000; // 50MP
const MAX_SOURCE_EDGE = 20_000;

export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

export async function processImage(
  input: Buffer,
  policy: BucketPolicy,
): Promise<ProcessedImage> {
  const maxEdge = policy.maxEdge ?? 2000;

  let metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
  } catch {
    // Deliberately generic: echoing a decoder's error message back to the user
    // leaks library internals and helps an attacker probe for parser bugs.
    throw new ImageProcessingError('That file could not be read as an image.');
  }

  const { width, height } = metadata;
  if (!width || !height) {
    throw new ImageProcessingError('That file could not be read as an image.');
  }

  if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE) {
    throw new ImageProcessingError('That image is too large. Maximum 20000px on a side.');
  }

  // An animated GIF or multi-page TIFF arrives as one tall strip; treating it
  // as a still is fine, but the page count is a memory concern.
  if ((metadata.pages ?? 1) > 1) {
    throw new ImageProcessingError('Animated images are not supported.');
  }

  const pipeline = sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS })
    // .rotate() with no argument applies the EXIF orientation flag and then
    // discards it, so the image is upright in the output. Without this, photos
    // taken in portrait appear sideways once metadata is stripped.
    .rotate()
    .resize({
      width: maxEdge,
      height: policy.square ? maxEdge : undefined,
      fit: policy.square ? 'cover' : 'inside',
      // Never upscale a small image into a blurry large one.
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 });

  let output: { data: Buffer; info: OutputInfo };
  try {
    output = await pipeline.toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageProcessingError('That image could not be processed.');
  }

  return {
    buffer: output.data,
    contentType: 'image/webp',
    width: output.info.width,
    height: output.info.height,
  };
}

/**
 * Confirms a processed image carries no metadata.
 *
 * Called by the test suite rather than the upload path — it is an assertion
 * about sharp's behaviour, and behaviour we depend on should be verified
 * rather than assumed.
 */
export async function readMetadata(buffer: Buffer): Promise<{
  hasExif: boolean;
  hasIcc: boolean;
  hasXmp: boolean;
  format: string | undefined;
  width: number | undefined;
  height: number | undefined;
}> {
  const metadata = await sharp(buffer).metadata();
  return {
    hasExif: metadata.exif !== undefined,
    hasIcc: metadata.icc !== undefined,
    hasXmp: metadata.xmp !== undefined,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
  };
}
