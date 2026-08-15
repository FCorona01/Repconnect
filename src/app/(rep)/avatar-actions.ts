'use server';

import { revalidatePath } from 'next/cache';

import { getActor } from '@/lib/auth/session';
import { policyFor } from '@/lib/files/policy';
import { formatBytes } from '@/lib/files/policy';
import { setRepProfileAvatar, uploadFile } from '@/lib/repositories/files';
import { getMyRepProfile } from '@/lib/repositories/rep-profiles';

export interface AvatarActionState {
  error?: string;
  ok?: boolean;
}

/**
 * Uploads and applies a profile photo.
 *
 * The actor comes from the session, never from the form — a userId field in a
 * multipart body would be an authorization hole with a friendly name.
 */
export async function uploadAvatarAction(
  _previous: AvatarActionState,
  formData: FormData,
): Promise<AvatarActionState> {
  const actor = await getActor();

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.' };
  }

  const policy = policyFor('avatars');

  // Cheap rejection before reading the whole thing into memory. The repository
  // checks the real size again from the buffer it actually received — a
  // client-reported size is not evidence.
  if (file.size > policy.maxBytes) {
    return { error: `That image is larger than ${formatBytes(policy.maxBytes)}.` };
  }

  const body = Buffer.from(await file.arrayBuffer());

  const uploaded = await uploadFile(actor, {
    bucket: 'avatars',
    originalFilename: file.name,
    body,
  });

  if (!uploaded.ok) return { error: uploaded.error.message };

  const applied = await setRepProfileAvatar(actor, uploaded.data.id);
  if (!applied.ok) return { error: applied.error.message };

  const profile = await getMyRepProfile(actor);
  if (profile.ok) revalidatePath(`/r/${profile.data.slug}`);

  return { ok: true };
}

export async function removeAvatarAction(): Promise<AvatarActionState> {
  const actor = await getActor();

  const applied = await setRepProfileAvatar(actor, null);
  if (!applied.ok) return { error: applied.error.message };

  const profile = await getMyRepProfile(actor);
  if (profile.ok) revalidatePath(`/r/${profile.data.slug}`);

  return { ok: true };
}
