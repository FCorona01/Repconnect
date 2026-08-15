/**
 * Content-type detection from the file's actual bytes.
 *
 * An attacker renames payload.exe to photo.png; the bytes do not lie. The
 * browser-supplied MIME type and the filename extension are both attacker
 * controlled and are never trusted.
 *
 * WHY THIS IS HAND-ROLLED RATHER THAN A LIBRARY
 * ---------------------------------------------
 * This is not parsing — it is comparing a handful of leading bytes against
 * fixed constants for the four formats we accept. Hand-rolling something that
 * genuinely parses untrusted input would be a bad idea; comparing byte
 * prefixes is not that, and keeping it explicit means the whole allowlist is
 * auditable in one screen.
 *
 * It is also NOT the last line of defence. Every accepted image is decoded and
 * re-encoded by sharp (a real, hardened parser), which both validates the file
 * and destroys anything hidden inside it — including polyglot files that are
 * simultaneously a valid image and a valid script. See ./image.ts.
 */

export type DetectedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

interface Signature {
  type: DetectedType;
  offset: number;
  bytes: number[];
  /** Extra check for containers whose magic number is not unique. */
  verify?: (buffer: Buffer) => boolean;
}

const SIGNATURES: Signature[] = [
  { type: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  {
    // RIFF is a container used by several formats; the 'WEBP' fourcc at byte 8
    // is what distinguishes a WebP image from, say, a WAV file.
    type: 'image/webp',
    offset: 0,
    bytes: [0x52, 0x49, 0x46, 0x46], // 'RIFF'
    verify: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP',
  },
  { type: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // '%PDF-'
];

function matches(buffer: Buffer, signature: Signature): boolean {
  const end = signature.offset + signature.bytes.length;
  if (buffer.length < end) return false;

  for (let i = 0; i < signature.bytes.length; i += 1) {
    if (buffer[signature.offset + i] !== signature.bytes[i]) return false;
  }

  return signature.verify ? signature.verify(buffer) : true;
}

/** The detected type, or null if the bytes match nothing we accept. */
export function detectContentType(buffer: Buffer): DetectedType | null {
  for (const signature of SIGNATURES) {
    if (matches(buffer, signature)) return signature.type;
  }
  return null;
}

export function isImageType(type: DetectedType): boolean {
  return type !== 'application/pdf';
}

/**
 * SVG is deliberately absent from the allowlist above.
 *
 * An SVG is an XML document that can carry <script>, external references and
 * event handlers. Serving one from our own origin is a cross-site scripting
 * vector, and unlike a raster image it cannot be neutralised by re-encoding.
 * Company logos are accepted as raster images only.
 */
export const REJECTED_BY_DESIGN = ['image/svg+xml', 'text/html', 'application/xml'] as const;
