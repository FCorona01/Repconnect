import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { isAuthenticated, type Actor } from '@/lib/auth/actor';
import { withActor } from '@/lib/db/rls';
import { files, repProfiles, type FileBucket, type FileVisibility } from '@/lib/db/schema';
import { conflict, err, forbidden, notFound, ok, type Result } from '@/lib/errors';
import { ImageProcessingError, processImage } from '@/lib/files/image';
import { formatBytes, isAcceptedIn, policyFor } from '@/lib/files/policy';
import { detectContentType, isImageType } from '@/lib/files/signatures';
import { storage } from '@/lib/files/storage';
import { canActInOrg } from '@/lib/permissions';

import { recordAudit } from './audit';
import { refreshRepProfileCompleteness } from './rep-profiles';

/**
 * The file pipeline.
 *
 * Order matters and is the same for every upload:
 *
 *   1. authorize     — may this actor write to this bucket at all?
 *   2. size          — cheapest rejection first, before touching the bytes
 *   3. magic bytes   — what IS this file, ignoring its name and declared type
 *   4. bucket policy — is that type allowed HERE
 *   5. re-encode     — validates, strips metadata, destroys payloads (images)
 *   6. store         — under a server-generated name
 *   7. record + audit
 *
 * Nothing user-supplied is trusted: not the filename, not the content type,
 * not the size the client claims.
 */

const SIGNED_URL_TTL_SECONDS = 300;

export interface UploadInput {
  bucket: FileBucket;
  /** Only ever used as a display label. Never as a path. */
  originalFilename: string;
  body: Buffer;
  /** Required for the logos bucket; ignored elsewhere. */
  organizationId?: string;
}

export interface UploadedFile {
  id: string;
  bucket: FileBucket;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

/**
 * Who may put a file in which bucket.
 *
 * Separate from the RLS insert policy on `files` deliberately: RLS enforces
 * "the owner column must be you", while this enforces the bucket-specific
 * rules that RLS cannot express (logo uploads require org membership).
 */
function canUploadTo(
  actor: Actor,
  bucket: FileBucket,
  organizationId?: string,
): boolean {
  if (!isAuthenticated(actor)) return false;

  switch (bucket) {
    case 'avatars':
    case 'documents':
    case 'verification':
      return true;
    case 'logos':
      // A logo belongs to a company, so uploading one requires the right to
      // act for that company.
      return organizationId !== undefined && canActInOrg(actor, organizationId, 'admin');
  }
}

function visibilityFor(bucket: FileBucket): FileVisibility {
  switch (bucket) {
    case 'logos':
      return 'public'; // marketing assets
    case 'avatars':
      // Follows the profile: the avatar is only reachable through a profile the
      // viewer can already see, which the files SELECT policy enforces.
      return 'private';
    case 'documents':
    case 'verification':
      return 'private';
  }
}

export async function uploadFile(
  actor: Actor,
  input: UploadInput,
): Promise<Result<UploadedFile>> {
  if (!isAuthenticated(actor)) return err(forbidden());
  if (!canUploadTo(actor, input.bucket, input.organizationId)) return err(forbidden());

  const policy = policyFor(input.bucket);

  // 2. Size, before any decoding work.
  if (input.body.length === 0) {
    return err({ code: 'validation', message: 'That file is empty.' });
  }
  if (input.body.length > policy.maxBytes) {
    return err({
      code: 'validation',
      message: `That file is ${formatBytes(input.body.length)}. The limit is ${formatBytes(policy.maxBytes)}.`,
    });
  }

  // 3. What the bytes actually are. The declared content type and the filename
  //    extension are attacker-controlled and play no part in this decision.
  const detected = detectContentType(input.body);
  if (!detected) {
    return err({
      code: 'validation',
      message: 'That file type is not supported. Upload a JPEG, PNG, WebP or PDF.',
    });
  }

  // 4. Allowed in THIS bucket?
  if (!isAcceptedIn(input.bucket, detected)) {
    return err({
      code: 'validation',
      message: `${detected} files cannot be uploaded here.`,
    });
  }

  // 5. Images are re-encoded; PDFs are stored as-is but never rendered inline.
  let body = input.body;
  let contentType: string = detected;
  let width: number | null = null;
  let height: number | null = null;

  if (isImageType(detected)) {
    try {
      const processed = await processImage(input.body, policy);
      body = processed.buffer;
      contentType = processed.contentType;
      width = processed.width;
      height = processed.height;
    } catch (error) {
      if (error instanceof ImageProcessingError) {
        return err({ code: 'validation', message: error.message });
      }
      throw error;
    }
  }

  // 6. Server-generated path. The user's filename never touches the filesystem
  //    or the storage key — it is a path-traversal vector and a collision risk,
  //    and it is kept only as a display label on the row.
  const storagePath = `${actor.userId}/${randomUUID()}`;
  const checksum = createHash('sha256').update(body).digest('hex');

  await storage().put(input.bucket, storagePath, body, contentType);

  // 7. Record. If this fails the object is orphaned rather than the row being
  //    wrong — an orphan costs storage, a wrong row costs authorization.
  return withActor(actor, async (tx) => {
    const [created] = await tx
      .insert(files)
      .values({
        ownerUserId: actor.userId,
        organizationId: input.organizationId ?? null,
        bucket: input.bucket,
        visibility: visibilityFor(input.bucket),
        storagePath,
        originalFilename: input.originalFilename.slice(0, 255),
        contentType,
        sizeBytes: body.length,
        checksumSha256: checksum,
        // Images have been decoded and re-encoded, which destroys embedded
        // payloads. PDFs are not scanned yet — see migration 0010.
        scanStatus: isImageType(detected) ? 'clean' : 'pending',
        imageWidth: width,
        imageHeight: height,
      })
      .returning({ id: files.id });

    if (!created) {
      await storage().remove(input.bucket, storagePath);
      return err(conflict('Could not save that file.'));
    }

    await recordAudit(tx, actor, {
      action: 'file.uploaded',
      targetType: 'file',
      targetId: created.id,
      after: {
        bucket: input.bucket,
        contentType,
        sizeBytes: body.length,
        declaredName: input.originalFilename.slice(0, 255),
      },
    });

    return ok({
      id: created.id,
      bucket: input.bucket,
      contentType,
      sizeBytes: body.length,
      width,
      height,
    });
  });
}

export interface FileRef {
  id: string;
  bucket: FileBucket;
  storagePath: string;
  contentType: string;
  originalFilename: string;
  sizeBytes: number;
  imageWidth: number | null;
  imageHeight: number | null;
}

/**
 * Loads a file the caller is permitted to see.
 *
 * The read runs under RLS, so visibility is decided by the database. A file the
 * caller may not see is reported as not-found — never as forbidden, which would
 * confirm the file exists.
 */
export async function getFile(actor: Actor, fileId: string): Promise<Result<FileRef>> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        id: files.id,
        bucket: files.bucket,
        storagePath: files.storagePath,
        contentType: files.contentType,
        originalFilename: files.originalFilename,
        sizeBytes: files.sizeBytes,
        imageWidth: files.imageWidth,
        imageHeight: files.imageHeight,
      })
      .from(files)
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
      .limit(1);

    return row ? ok(row) : err(notFound());
  });
}

/**
 * A short-lived download link, issued only after the authorization check above.
 *
 * The URL is minted per request and never stored, cached, or embedded in a
 * response that a CDN could cache — a cached signed URL is a public URL with
 * extra steps.
 */
export async function getFileUrl(
  actor: Actor,
  fileId: string,
): Promise<Result<{ url: string; contentType: string }>> {
  const file = await getFile(actor, fileId);
  if (!file.ok) return err(file.error);

  const direct = await storage().directUrl(
    file.data.bucket,
    file.data.storagePath,
    SIGNED_URL_TTL_SECONDS,
  );

  // No signing service (local development) means streaming through our own
  // route, which re-authorizes every request rather than trusting a token.
  return ok({
    url: direct ?? `/api/files/${file.data.id}`,
    contentType: file.data.contentType,
  });
}

/** Streams the bytes. Used by the download route, which sets attachment headers. */
export async function readFileBytes(
  actor: Actor,
  fileId: string,
): Promise<Result<{ body: Buffer; file: FileRef }>> {
  const file = await getFile(actor, fileId);
  if (!file.ok) return err(file.error);

  const body = await storage().get(file.data.bucket, file.data.storagePath);
  return ok({ body, file: file.data });
}

export async function deleteFile(
  actor: Actor,
  fileId: string,
): Promise<Result<{ deleted: true }>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  const target = await withActor(actor, async (tx) => {
    // Ownership is in the WHERE clause: zero rows is the refusal, with no
    // window between checking and deleting.
    const [row] = await tx
      .update(files)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(files.id, fileId),
          eq(files.ownerUserId, actor.userId),
          isNull(files.deletedAt),
        ),
      )
      .returning({ bucket: files.bucket, storagePath: files.storagePath });

    if (!row) return err(notFound());

    await recordAudit(tx, actor, {
      action: 'file.deleted',
      targetType: 'file',
      targetId: fileId,
      before: { bucket: row.bucket },
    });

    return ok(row);
  });

  if (!target.ok) return err(target.error);

  // Bytes go after the row is marked deleted. If this throws, the file is
  // already unreachable through the application.
  await storage().remove(target.data.bucket, target.data.storagePath);

  return ok({ deleted: true as const });
}

/**
 * Points a rep profile at an uploaded avatar.
 *
 * A database trigger independently verifies that the file is in the avatars
 * bucket and owned by the same user, so pointing an avatar at someone else's
 * document id fails even if this function were bypassed.
 */
export async function setRepProfileAvatar(
  actor: Actor,
  fileId: string | null,
): Promise<Result<{ avatarFileId: string | null }>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  return withActor(actor, async (tx) => {
    const [updated] = await tx
      .update(repProfiles)
      .set({ avatarFileId: fileId })
      .where(eq(repProfiles.userId, actor.userId))
      .returning({ avatarFileId: repProfiles.avatarFileId, id: repProfiles.id });

    if (!updated) return err(notFound());

    // Completeness counts the avatar, so recompute it from the profile's real
    // state rather than nudging the stored number by a delta — a delta drifts
    // the moment any other path touches the profile.
    await refreshRepProfileCompleteness(tx, updated.id);

    await recordAudit(tx, actor, {
      action: fileId ? 'rep_profile.avatar_set' : 'rep_profile.avatar_removed',
      targetType: 'rep_profile',
      targetId: updated.id,
      after: { avatarFileId: fileId },
    });

    return ok({ avatarFileId: updated.avatarFileId });
  });
}
