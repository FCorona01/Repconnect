import 'server-only';

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import type { FileBucket } from '@/lib/db/schema';

/**
 * Object storage, behind a small interface.
 *
 * Production uses Supabase Storage. Local development and CI use the
 * filesystem, so the upload pipeline — validation, re-encoding, authorization,
 * signed-link issuance — runs identically in tests without needing a Supabase
 * project. The part that differs between the two is only "where do the bytes
 * physically go", which is exactly the part that carries no security logic.
 */
export interface StorageAdapter {
  readonly kind: 'supabase' | 'local';
  put(bucket: FileBucket, path: string, body: Buffer, contentType: string): Promise<void>;
  get(bucket: FileBucket, path: string): Promise<Buffer>;
  remove(bucket: FileBucket, path: string): Promise<void>;
  /**
   * A time-limited direct URL, or null when the backend has no signing service
   * and the bytes must be streamed through our own authorized route instead.
   *
   * Callers MUST have authorized the request against the `files` row first —
   * this does no checking of its own, by design. An adapter that silently
   * authorized would hide the check from review.
   */
  directUrl(
    bucket: FileBucket,
    path: string,
    expiresInSeconds: number,
  ): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

class SupabaseStorageAdapter implements StorageAdapter {
  readonly kind = 'supabase' as const;

  private client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    // The service role key. It never reaches the browser, and it is used only
    // here — every call is preceded by an authorization check in the files
    // repository.
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  async put(
    bucket: FileBucket,
    path: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.client.storage.from(bucket).upload(path, body, {
      contentType,
      // Paths are server-generated UUIDs, so a collision means a bug, not a
      // retry. Refusing to overwrite makes that bug visible.
      upsert: false,
    });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  async get(bucket: FileBucket, path: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(bucket).download(path);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(bucket: FileBucket, path: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([path]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }

  async directUrl(
    bucket: FileBucket,
    path: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`Could not sign URL: ${error?.message}`);
    return data.signedUrl;
  }
}

// ---------------------------------------------------------------------------
// Local filesystem
// ---------------------------------------------------------------------------

const LOCAL_ROOT = resolve(process.cwd(), '.storage');

class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;

  private resolvePath(bucket: FileBucket, path: string): string {
    const target = resolve(join(LOCAL_ROOT, bucket, path));

    // Paths are server-generated, but resolving and re-checking costs nothing
    // and means a future caller that passes something user-influenced cannot
    // escape the storage root.
    const root = resolve(join(LOCAL_ROOT, bucket));
    if (target !== root && !target.startsWith(root + '/')) {
      throw new Error('Refusing to access a path outside the storage root');
    }
    return target;
  }

  async put(bucket: FileBucket, path: string, body: Buffer): Promise<void> {
    const target = this.resolvePath(bucket, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, { flag: 'wx' });
  }

  async get(bucket: FileBucket, path: string): Promise<Buffer> {
    return readFile(this.resolvePath(bucket, path));
  }

  async remove(bucket: FileBucket, path: string): Promise<void> {
    await rm(this.resolvePath(bucket, path), { force: true });
  }

  /**
   * There is no local signing service, so there is no direct URL. Returning
   * null makes the caller stream the bytes through our own route, which
   * re-authorizes on every request — strictly stronger than a signed URL, and
   * it guarantees local behaviour is never more permissive than production.
   */
  async directUrl(): Promise<null> {
    return null;
  }
}

// ---------------------------------------------------------------------------

let cached: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (cached) return cached;

  const hasSupabase =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('placeholder');

  cached = hasSupabase ? new SupabaseStorageAdapter() : new LocalStorageAdapter();
  return cached;
}

/** Test seam. */
export function resetStorageForTests(): void {
  cached = null;
}

export const LOCAL_STORAGE_ROOT = LOCAL_ROOT;
