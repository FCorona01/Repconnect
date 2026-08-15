import type { FileBucket } from '@/lib/db/schema';

import type { DetectedType } from './signatures';

/**
 * Per-bucket upload rules.
 *
 * One table, so "what may be uploaded where, and how large" is answerable by
 * reading a single object rather than tracing branches through upload code.
 * The database (bucket limits in migration 0010) enforces its own copy as a
 * backstop.
 */

export interface BucketPolicy {
  /** Hard size cap on the ORIGINAL upload, before re-encoding. */
  maxBytes: number;
  accepts: readonly DetectedType[];
  /** Images are re-encoded to webp and bounded by this edge length. */
  maxEdge?: number;
  /** Square crop — used for avatars, where a consistent shape matters. */
  square?: boolean;
  /** Who may be issued a download link. Enforced in SQL by the files policies. */
  description: string;
}

export const BUCKET_POLICIES: Record<FileBucket, BucketPolicy> = {
  avatars: {
    maxBytes: 5 * 1024 * 1024,
    accepts: ['image/jpeg', 'image/png', 'image/webp'],
    maxEdge: 512,
    square: true,
    description: 'Profile photos. Visible to anyone who can view the profile.',
  },
  logos: {
    maxBytes: 5 * 1024 * 1024,
    accepts: ['image/jpeg', 'image/png', 'image/webp'],
    maxEdge: 512,
    description: 'Company logos. Marketing assets, visible with the company profile.',
  },
  documents: {
    maxBytes: 25 * 1024 * 1024,
    // PDF only. We cannot meaningfully validate a .docx, cannot render one,
    // and accepting office formats means accepting macro-bearing files.
    accepts: ['application/pdf'],
    description: 'Resumes, portfolios, case studies. Private to the owner and businesses they apply to.',
  },
  verification: {
    maxBytes: 10 * 1024 * 1024,
    accepts: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    maxEdge: 2000,
    description: 'Identity and business documents. Readable by admins only, deleted after review.',
  },
};

export function policyFor(bucket: FileBucket): BucketPolicy {
  return BUCKET_POLICIES[bucket];
}

export function isAcceptedIn(bucket: FileBucket, type: DetectedType): boolean {
  return BUCKET_POLICIES[bucket].accepts.includes(type);
}

/** Human-readable size, for error messages a person can act on. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
