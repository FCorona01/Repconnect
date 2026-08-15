import { rm } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { Exif } from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ANONYMOUS } from '@/lib/auth/actor';
import { db } from '@/lib/db/client';
import { withActor } from '@/lib/db/rls';
import { readMetadata } from '@/lib/files/image';
import { BUCKET_POLICIES } from '@/lib/files/policy';
import { detectContentType } from '@/lib/files/signatures';
import { LOCAL_STORAGE_ROOT, storage } from '@/lib/files/storage';
import {
  deleteFile,
  getFile,
  getFileUrl,
  readFileBytes,
  setRepProfileAvatar,
  uploadFile,
} from '@/lib/repositories/files';
import { createRepProfile, getRepProfileBySlug } from '@/lib/repositories/rep-profiles';

import {
  actorFor,
  addMembership,
  closeDb,
  createOrganization,
  createUser,
} from './setup/fixtures';

afterAll(async () => {
  await rm(LOCAL_STORAGE_ROOT, { recursive: true, force: true });
  await closeDb();
});

// ---------------------------------------------------------------------------
// Test material
// ---------------------------------------------------------------------------

/**
 * A JPEG carrying the metadata a phone camera would write, GPS included.
 *
 * sharp writes a GPS IFD at runtime but its published types only declare
 * IFD0–IFD3, so the cast is a types gap rather than an unsupported feature —
 * verified: the resulting file does contain GPS EXIF bytes.
 */
async function jpegWithExifGps(width = 800, height = 600): Promise<Buffer> {
  const exif: Exif = {
    IFD0: { Copyright: 'RepConnect Test', Make: 'TestCam' },
    ...({ GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' } } as Exif),
  };

  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .jpeg()
    .withExifMerge(exif)
    .toBuffer();
}

async function pngBuffer(width = 400, height = 400): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#cc0000' } })
    .png()
    .toBuffer();
}

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const EXECUTABLE_BYTES = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'binary');
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML_BYTES = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');

// ===========================================================================
// Magic bytes — the file is what its bytes say, not what its name says
// ===========================================================================

describe('content type detection', () => {
  it('identifies the formats we accept', async () => {
    expect(detectContentType(await jpegWithExifGps())).toBe('image/jpeg');
    expect(detectContentType(await pngBuffer())).toBe('image/png');
    expect(detectContentType(PDF_BYTES)).toBe('application/pdf');

    const webp = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#000' },
    })
      .webp()
      .toBuffer();
    expect(detectContentType(webp)).toBe('image/webp');
  });

  it('rejects an executable, a script and an SVG', () => {
    // SVG is XML that can carry <script>. Unlike a raster image it cannot be
    // neutralised by re-encoding, so it is not on the allowlist at all.
    expect(detectContentType(EXECUTABLE_BYTES)).toBeNull();
    expect(detectContentType(SVG_BYTES)).toBeNull();
    expect(detectContentType(HTML_BYTES)).toBeNull();
    expect(detectContentType(Buffer.from(''))).toBeNull();
    expect(detectContentType(Buffer.from('just some text'))).toBeNull();
  });

  it('is not fooled by a RIFF container that is not a WebP', () => {
    // 'RIFF' alone is shared with WAV and AVI; the fourcc at byte 8 decides.
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE'),
    ]);
    expect(detectContentType(wav)).toBeNull();
  });

  it('is not fooled by a renamed file — extension plays no part', async () => {
    const jpeg = await jpegWithExifGps();
    // The detector never sees a filename. Same bytes, same answer.
    expect(detectContentType(jpeg)).toBe('image/jpeg');
  });
});

// ===========================================================================
// Upload pipeline
// ===========================================================================

describe('upload validation', () => {
  it('rejects a renamed executable even with an image filename', async () => {
    const user = await createUser();

    const result = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'innocent-photo.png',
      body: EXECUTABLE_BYTES,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });

  it('rejects an SVG uploaded as a logo', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);

    const result = await uploadFile(await actorFor(owner.id), {
      bucket: 'logos',
      originalFilename: 'logo.svg',
      body: SVG_BYTES,
      organizationId: org.id,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a file over the bucket size limit', async () => {
    const user = await createUser();
    const oversized = Buffer.concat([
      await pngBuffer(10, 10),
      Buffer.alloc(BUCKET_POLICIES.avatars.maxBytes),
    ]);

    const result = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'huge.png',
      body: oversized,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/limit is/i);
  });

  it('rejects an empty file', async () => {
    const user = await createUser();
    const result = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'empty.png',
      body: Buffer.alloc(0),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a PDF in the avatars bucket, though it is a valid PDF', async () => {
    // Type detection and bucket policy are separate gates: being a real file of
    // a supported kind is not the same as being allowed here.
    const user = await createUser();

    const result = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'resume.pdf',
      body: PDF_BYTES,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects an image in the documents bucket', async () => {
    const user = await createUser();
    const result = await uploadFile(await actorFor(user.id), {
      bucket: 'documents',
      originalFilename: 'photo.png',
      body: await pngBuffer(),
    });
    expect(result.ok).toBe(false);
  });

  it('anonymous callers cannot upload', async () => {
    const result = await uploadFile(ANONYMOUS, {
      bucket: 'avatars',
      originalFilename: 'a.png',
      body: await pngBuffer(),
    });
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// Image processing — EXIF removal and resizing
// ===========================================================================

describe('image normalisation', () => {
  it('strips EXIF, including GPS coordinates', async () => {
    const source = await jpegWithExifGps();
    expect((await readMetadata(source)).hasExif).toBe(true);

    const user = await createUser();
    const uploaded = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'holiday-photo.jpg',
      body: source,
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const stored = await readFileBytes(await actorFor(user.id), uploaded.data.id);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    const metadata = await readMetadata(stored.data.body);

    // A phone camera writes the location the photo was taken. A rep uploading
    // a photo taken at home must not be publishing their home address.
    expect(metadata.hasExif).toBe(false);
    expect(metadata.hasXmp).toBe(false);
  });

  it('re-encodes to webp regardless of what was uploaded', async () => {
    const user = await createUser();

    for (const [name, body] of [
      ['jpeg', await jpegWithExifGps(300, 300)],
      ['png', await pngBuffer(300, 300)],
    ] as const) {
      const uploaded = await uploadFile(await actorFor(user.id), {
        bucket: 'documents',
        originalFilename: `${name}.bin`,
        body,
      }).then((r) => r);

      // documents rejects images — use verification, which accepts both.
      expect(uploaded.ok).toBe(false);
    }

    const uploaded = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'photo.jpg',
      body: await jpegWithExifGps(300, 300),
    });

    expect(uploaded.ok).toBe(true);
    if (uploaded.ok) expect(uploaded.data.contentType).toBe('image/webp');
  });

  it('resizes an oversized image down to the bucket limit', async () => {
    const user = await createUser();
    const large = await jpegWithExifGps(2400, 1600);

    const uploaded = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'large.jpg',
      body: large,
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    // Avatars are square-cropped to 512.
    expect(uploaded.data.width).toBe(512);
    expect(uploaded.data.height).toBe(512);
    expect(uploaded.data.sizeBytes).toBeLessThan(large.length);
  });

  it('does not upscale a small image into a blurry large one', async () => {
    const user = await createUser();
    const small = await pngBuffer(64, 64);

    const uploaded = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'small.png',
      body: small,
    });

    expect(uploaded.ok).toBe(true);
    if (uploaded.ok) {
      expect(uploaded.data.width).toBeLessThanOrEqual(64);
    }
  });

  it('records dimensions so pages can reserve space before the image loads', async () => {
    const user = await createUser();
    const uploaded = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: 'x.png',
      body: await pngBuffer(800, 800),
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const file = await getFile(await actorFor(user.id), uploaded.data.id);
    expect(file.ok).toBe(true);
    if (file.ok) {
      expect(file.data.imageWidth).toBe(512);
      expect(file.data.imageHeight).toBe(512);
    }
  });
});

// ===========================================================================
// Server-generated names
// ===========================================================================

describe('storage paths', () => {
  it('never uses the uploaded filename as the storage path', async () => {
    const user = await createUser();
    const hostile = '../../../etc/passwd';

    const uploaded = await uploadFile(await actorFor(user.id), {
      bucket: 'avatars',
      originalFilename: hostile,
      body: await pngBuffer(),
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const rows = await db.execute<{ storage_path: string; original_filename: string }>(
      sql`select storage_path, original_filename from files where id = ${uploaded.data.id}`,
    );
    const row = (rows as unknown as Array<{ storage_path: string; original_filename: string }>)[0];

    // The hostile name survives only as a display label.
    expect(row?.original_filename).toBe(hostile);
    // The path is <userId>/<uuid> and contains nothing user-supplied.
    expect(row?.storage_path).not.toContain('..');
    expect(row?.storage_path).not.toContain('passwd');
    expect(row?.storage_path).toMatch(
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i,
    );
  });
});

// ===========================================================================
// Download authorization
// ===========================================================================

describe('download authorization', () => {
  it('another user cannot read a private document', async () => {
    const owner = await createUser();
    const stranger = await createUser();

    const uploaded = await uploadFile(await actorFor(owner.id), {
      bucket: 'documents',
      originalFilename: 'resume.pdf',
      body: PDF_BYTES,
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const asStranger = await getFile(await actorFor(stranger.id), uploaded.data.id);
    expect(asStranger.ok).toBe(false);
    // Not-found, never forbidden — a 403 would confirm the file exists.
    if (!asStranger.ok) expect(asStranger.error.code).toBe('not_found');

    expect((await getFileUrl(await actorFor(stranger.id), uploaded.data.id)).ok).toBe(false);
    expect((await readFileBytes(await actorFor(stranger.id), uploaded.data.id)).ok).toBe(false);
  });

  it('anonymous visitors cannot read a private document', async () => {
    const owner = await createUser();
    const uploaded = await uploadFile(await actorFor(owner.id), {
      bucket: 'documents',
      originalFilename: 'resume.pdf',
      body: PDF_BYTES,
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    expect((await getFile(ANONYMOUS, uploaded.data.id)).ok).toBe(false);
    expect((await readFileBytes(ANONYMOUS, uploaded.data.id)).ok).toBe(false);
  });

  it('the owner can read their own file', async () => {
    const owner = await createUser();
    const uploaded = await uploadFile(await actorFor(owner.id), {
      bucket: 'documents',
      originalFilename: 'resume.pdf',
      body: PDF_BYTES,
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const read = await readFileBytes(await actorFor(owner.id), uploaded.data.id);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.data.body.equals(PDF_BYTES)).toBe(true);
  });

  it('a verification document is readable by admins only — never a counterparty', async () => {
    const rep = await createUser();
    const businessOwner = await createUser();
    const org = await createOrganization(businessOwner.id);
    const recruiter = await createUser();
    await addMembership(org.id, recruiter.id, 'recruiter');

    const uploaded = await uploadFile(await actorFor(rep.id), {
      bucket: 'verification',
      originalFilename: 'passport.png',
      body: await pngBuffer(),
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    // The business the rep might apply to must never reach this.
    expect((await getFile(await actorFor(recruiter.id), uploaded.data.id)).ok).toBe(false);
    expect((await getFile(ANONYMOUS, uploaded.data.id)).ok).toBe(false);

    const adminUser = await createUser({ platformRole: 'admin' });
    expect((await getFile(await actorFor(adminUser.id), uploaded.data.id)).ok).toBe(true);
  });

  it('a deleted file becomes unreadable', async () => {
    const owner = await createUser();
    const ownerActor = await actorFor(owner.id);

    const uploaded = await uploadFile(ownerActor, {
      bucket: 'documents',
      originalFilename: 'resume.pdf',
      body: PDF_BYTES,
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    expect((await deleteFile(ownerActor, uploaded.data.id)).ok).toBe(true);
    expect((await getFile(ownerActor, uploaded.data.id)).ok).toBe(false);
  });

  it('a user cannot delete another user\'s file', async () => {
    const owner = await createUser();
    const attacker = await createUser();

    const uploaded = await uploadFile(await actorFor(owner.id), {
      bucket: 'documents',
      originalFilename: 'resume.pdf',
      body: PDF_BYTES,
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    expect((await deleteFile(await actorFor(attacker.id), uploaded.data.id)).ok).toBe(false);
    // And the file is genuinely still there.
    expect((await getFile(await actorFor(owner.id), uploaded.data.id)).ok).toBe(true);
  });
});

// ===========================================================================
// Bucket-specific upload authorization
// ===========================================================================

describe('bucket upload authorization', () => {
  it('a non-member cannot upload a logo for an organisation', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const outsider = await createUser();

    const result = await uploadFile(await actorFor(outsider.id), {
      bucket: 'logos',
      originalFilename: 'logo.png',
      body: await pngBuffer(),
      organizationId: org.id,
    });

    expect(result.ok).toBe(false);
  });

  it('a recruiter cannot upload a logo — it takes org admin', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const recruiter = await createUser();
    await addMembership(org.id, recruiter.id, 'recruiter');

    const result = await uploadFile(await actorFor(recruiter.id), {
      bucket: 'logos',
      originalFilename: 'logo.png',
      body: await pngBuffer(),
      organizationId: org.id,
    });

    expect(result.ok).toBe(false);
  });

  it('an org admin can upload a logo', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);

    const result = await uploadFile(await actorFor(owner.id), {
      bucket: 'logos',
      originalFilename: 'logo.png',
      body: await pngBuffer(),
      organizationId: org.id,
    });

    expect(result.ok).toBe(true);
  });

  it('a logo upload with no organisation is refused', async () => {
    const user = await createUser();
    const result = await uploadFile(await actorFor(user.id), {
      bucket: 'logos',
      originalFilename: 'logo.png',
      body: await pngBuffer(),
    });
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// Avatars
// ===========================================================================

describe('profile avatars', () => {
  async function repWithProfile(visibility: 'public' | 'businesses_only') {
    const user = await createUser({ fullName: 'Avatar Rep' });
    const actor = await actorFor(user.id);
    const created = await createRepProfile(actor, {
      headline: 'Avatar test',
      visibility,
    });
    if (!created.ok) throw new Error('fixture failed');
    return { user, actor: await actorFor(user.id), slug: created.data.slug };
  }

  it('an avatar can be uploaded and applied, and appears on the profile', async () => {
    const rep = await repWithProfile('public');

    const uploaded = await uploadFile(rep.actor, {
      bucket: 'avatars',
      originalFilename: 'me.jpg',
      body: await jpegWithExifGps(),
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    expect((await setRepProfileAvatar(rep.actor, uploaded.data.id)).ok).toBe(true);

    const profile = await getRepProfileBySlug(ANONYMOUS, rep.slug);
    expect(profile.ok).toBe(true);
    if (profile.ok) expect(profile.data.avatarFileId).toBe(uploaded.data.id);
  });

  it('an avatar on a public profile is loadable by anyone', async () => {
    const rep = await repWithProfile('public');

    const uploaded = await uploadFile(rep.actor, {
      bucket: 'avatars',
      originalFilename: 'me.png',
      body: await pngBuffer(),
    });
    if (!uploaded.ok) throw new Error('upload failed');
    await setRepProfileAvatar(rep.actor, uploaded.data.id);

    // Files are stored private; a dedicated policy makes an avatar visible
    // exactly when the profile referencing it is visible.
    const stranger = await createUser();
    const url = await getFileUrl(await actorFor(stranger.id), uploaded.data.id);
    expect(url.ok).toBe(true);
    expect((await getFileUrl(ANONYMOUS, uploaded.data.id)).ok).toBe(true);
  });

  it('an avatar on a hidden profile is NOT loadable by a stranger', async () => {
    const rep = await repWithProfile('businesses_only');

    const uploaded = await uploadFile(rep.actor, {
      bucket: 'avatars',
      originalFilename: 'me.png',
      body: await pngBuffer(),
    });
    if (!uploaded.ok) throw new Error('upload failed');
    await setRepProfileAvatar(rep.actor, uploaded.data.id);

    expect((await getFileUrl(ANONYMOUS, uploaded.data.id)).ok).toBe(false);

    const plainUser = await createUser();
    expect((await getFileUrl(await actorFor(plainUser.id), uploaded.data.id)).ok).toBe(false);
  });

  it('an unattached avatar file stays private to its owner', async () => {
    const owner = await createUser();
    const uploaded = await uploadFile(await actorFor(owner.id), {
      bucket: 'avatars',
      originalFilename: 'unused.png',
      body: await pngBuffer(),
    });
    if (!uploaded.ok) throw new Error('upload failed');

    const stranger = await createUser();
    expect((await getFile(await actorFor(stranger.id), uploaded.data.id)).ok).toBe(false);
  });

  it('a rep cannot point their avatar at someone else\'s file', async () => {
    const rep = await repWithProfile('public');
    const other = await createUser();

    const theirFile = await uploadFile(await actorFor(other.id), {
      bucket: 'avatars',
      originalFilename: 'theirs.png',
      body: await pngBuffer(),
    });
    if (!theirFile.ok) throw new Error('upload failed');

    // A database trigger enforces this independently of application code, so
    // it holds even if a future code path forgets to check.
    let failed = false;
    try {
      await setRepProfileAvatar(rep.actor, theirFile.data.id);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('a rep cannot point their avatar at one of their own documents', async () => {
    const rep = await repWithProfile('public');

    const doc = await uploadFile(rep.actor, {
      bucket: 'documents',
      originalFilename: 'resume.pdf',
      body: PDF_BYTES,
    });
    if (!doc.ok) throw new Error('upload failed');

    let failed = false;
    try {
      await setRepProfileAvatar(rep.actor, doc.data.id);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('setting an avatar raises profile completeness', async () => {
    const rep = await repWithProfile('public');

    const before = await db.execute<{ profile_completeness: number }>(
      sql`select profile_completeness from rep_profiles where slug = ${rep.slug}`,
    );
    const beforeScore =
      (before as unknown as Array<{ profile_completeness: number }>)[0]
        ?.profile_completeness ?? 0;

    const uploaded = await uploadFile(rep.actor, {
      bucket: 'avatars',
      originalFilename: 'me.png',
      body: await pngBuffer(),
    });
    if (!uploaded.ok) throw new Error('upload failed');
    await setRepProfileAvatar(rep.actor, uploaded.data.id);

    const after = await db.execute<{ profile_completeness: number }>(
      sql`select profile_completeness from rep_profiles where slug = ${rep.slug}`,
    );
    const afterScore =
      (after as unknown as Array<{ profile_completeness: number }>)[0]
        ?.profile_completeness ?? 0;

    expect(afterScore).toBeGreaterThan(beforeScore);
  });
});

// ===========================================================================
// Storage isolation
// ===========================================================================

describe('storage adapter', () => {
  beforeAll(() => {
    // Tests run without Supabase configured, so the filesystem adapter is in
    // use. The authorization path above is identical either way — only where
    // the bytes land differs.
    expect(storage().kind).toBe('local');
  });

  it('refuses a path that escapes the storage root', async () => {
    let failed = false;
    try {
      await storage().put('avatars', '../../escape', Buffer.from('x'), 'text/plain');
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('a file row with no visibility grant is invisible even to a signed-in user', async () => {
    const owner = await createUser();
    const uploaded = await uploadFile(await actorFor(owner.id), {
      bucket: 'documents',
      originalFilename: 'private.pdf',
      body: PDF_BYTES,
    });
    if (!uploaded.ok) throw new Error('upload failed');

    const other = await createUser();
    const otherActor = await actorFor(other.id);

    // Bypassing the repository entirely: the database still refuses.
    const rows = await withActor(otherActor, async (tx) =>
      tx.execute(sql`select count(*)::int as n from files where id = ${uploaded.data.id}`),
    );
    expect((rows as unknown as Array<{ n: number }>)[0]?.n).toBe(0);
  });
});
