'use server';

import { redirect } from 'next/navigation';

import { getActor } from '@/lib/auth/session';
import { createOrganization } from '@/lib/repositories/organizations';

export interface NewOrgState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function createOrganizationAction(
  _previous: NewOrgState,
  formData: FormData,
): Promise<NewOrgState> {
  const actor = await getActor();

  const result = await createOrganization(actor, {
    slug: String(formData.get('slug') ?? ''),
    legalName: String(formData.get('legalName') ?? ''),
    displayName: String(formData.get('displayName') ?? ''),
    website: String(formData.get('website') ?? ''),
  });

  if (!result.ok) {
    return {
      error: result.error.message,
      ...(result.error.fields ? { fieldErrors: result.error.fields } : {}),
    };
  }

  redirect(`/organizations/${result.data.slug}/settings`);
}
