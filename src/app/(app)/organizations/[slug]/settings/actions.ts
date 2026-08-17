'use server';

import { revalidatePath } from 'next/cache';

import { getActor } from '@/lib/auth/session';
import { formatBytes, policyFor } from '@/lib/files/policy';
import { uploadFile } from '@/lib/repositories/files';
import {
  getOrganizationBySlug,
  setOrganizationLogo,
  updateOrganization,
  type UpdateOrganizationInput,
} from '@/lib/repositories/organizations';

export interface OrgSettingsState {
  error?: string;
  fieldErrors?: Record<string, string>;
  savedAt?: number;
}

/**
 * The slug in the URL is untrusted input. It is resolved to an id, and the
 * repository authorizes against that id independently — naming an organisation
 * grants nothing.
 */
async function resolveOrgId(slug: string): Promise<string | null> {
  const actor = await getActor();
  const org = await getOrganizationBySlug(actor, slug);
  return org.ok ? org.data.id : null;
}

export async function saveOrganizationAction(
  slug: string,
  input: UpdateOrganizationInput,
): Promise<OrgSettingsState> {
  const actor = await getActor();
  const organizationId = await resolveOrgId(slug);
  if (!organizationId) return { error: 'Not found.' };

  const result = await updateOrganization(actor, organizationId, input);
  if (!result.ok) {
    return {
      error: result.error.message,
      ...(result.error.fields ? { fieldErrors: result.error.fields } : {}),
    };
  }

  revalidatePath(`/organizations/${slug}/settings`);
  revalidatePath(`/c/${slug}`);
  revalidatePath('/dashboard');

  return { savedAt: Date.now() };
}

export async function uploadLogoAction(
  slug: string,
  _previous: OrgSettingsState,
  formData: FormData,
): Promise<OrgSettingsState> {
  const actor = await getActor();
  const organizationId = await resolveOrgId(slug);
  if (!organizationId) return { error: 'Not found.' };

  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.' };
  }

  const policy = policyFor('logos');
  if (file.size > policy.maxBytes) {
    return { error: `That image is larger than ${formatBytes(policy.maxBytes)}.` };
  }

  const uploaded = await uploadFile(actor, {
    bucket: 'logos',
    originalFilename: file.name,
    body: Buffer.from(await file.arrayBuffer()),
    organizationId,
  });

  if (!uploaded.ok) return { error: uploaded.error.message };

  const applied = await setOrganizationLogo(actor, organizationId, uploaded.data.id);
  if (!applied.ok) return { error: applied.error.message };

  revalidatePath(`/organizations/${slug}/settings`);
  revalidatePath(`/c/${slug}`);

  return { savedAt: Date.now() };
}

export async function removeLogoAction(slug: string): Promise<OrgSettingsState> {
  const actor = await getActor();
  const organizationId = await resolveOrgId(slug);
  if (!organizationId) return { error: 'Not found.' };

  const applied = await setOrganizationLogo(actor, organizationId, null);
  if (!applied.ok) return { error: applied.error.message };

  revalidatePath(`/organizations/${slug}/settings`);
  revalidatePath(`/c/${slug}`);

  return { savedAt: Date.now() };
}
