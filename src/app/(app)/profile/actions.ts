'use server';

import { revalidatePath } from 'next/cache';

import { getActor } from '@/lib/auth/session';
import type { RepVisibility } from '@/lib/db/schema';
import { policyFor, formatBytes } from '@/lib/files/policy';
import { setRepProfileAvatar, uploadFile } from '@/lib/repositories/files';
import {
  createRepProfile,
  getMyRepProfile,
  setRepProfileVisibility,
  updateRepProfile,
  type UpsertRepProfileInput,
} from '@/lib/repositories/rep-profiles';

/**
 * Rep profile actions.
 *
 * Each step of the wizard saves on its own, so a rep who closes the tab at step
 * 3 keeps steps 1 and 2. That matters more than it sounds: profile creation is
 * long, most reps do it on a phone, and losing entered work is the surest way
 * to lose the person entirely.
 *
 * The actor always comes from the session. There is no parameter through which
 * to name whose profile is being edited.
 */

export interface ProfileActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
  savedAt?: number;
}

export async function saveProfileStepAction(
  input: UpsertRepProfileInput,
): Promise<ProfileActionState> {
  const actor = await getActor();

  const existing = await getMyRepProfile(actor);

  // First save creates; every later one updates. The repository refuses a
  // second profile per user regardless.
  const result = existing.ok
    ? await updateRepProfile(actor, input)
    : await createRepProfile(actor, input);

  if (!result.ok) {
    return {
      error: result.error.message,
      ...(result.error.fields ? { fieldErrors: result.error.fields } : {}),
    };
  }

  revalidatePath('/profile');
  revalidatePath('/dashboard');
  revalidatePath(`/r/${result.data.slug}`);

  return { savedAt: Date.now() };
}

export async function setVisibilityAction(
  visibility: RepVisibility,
): Promise<ProfileActionState> {
  const actor = await getActor();

  const result = await setRepProfileVisibility(actor, visibility);
  if (!result.ok) return { error: result.error.message };

  const profile = await getMyRepProfile(actor);
  revalidatePath('/profile');
  if (profile.ok) revalidatePath(`/r/${profile.data.slug}`);

  return { savedAt: Date.now() };
}

export async function uploadAvatarAction(
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await getActor();

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.' };
  }

  const policy = policyFor('avatars');

  // Cheap rejection before reading the file into memory. The repository checks
  // the real size again from the buffer it actually received — a
  // client-reported size is not evidence.
  if (file.size > policy.maxBytes) {
    return { error: `That image is larger than ${formatBytes(policy.maxBytes)}.` };
  }

  const uploaded = await uploadFile(actor, {
    bucket: 'avatars',
    originalFilename: file.name,
    body: Buffer.from(await file.arrayBuffer()),
  });

  if (!uploaded.ok) return { error: uploaded.error.message };

  const applied = await setRepProfileAvatar(actor, uploaded.data.id);
  if (!applied.ok) return { error: applied.error.message };

  const profile = await getMyRepProfile(actor);
  revalidatePath('/profile');
  if (profile.ok) revalidatePath(`/r/${profile.data.slug}`);

  return { savedAt: Date.now() };
}

export async function removeAvatarAction(): Promise<ProfileActionState> {
  const actor = await getActor();

  const applied = await setRepProfileAvatar(actor, null);
  if (!applied.ok) return { error: applied.error.message };

  const profile = await getMyRepProfile(actor);
  revalidatePath('/profile');
  if (profile.ok) revalidatePath(`/r/${profile.data.slug}`);

  return { savedAt: Date.now() };
}
