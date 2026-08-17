'use server';

import { revalidatePath } from 'next/cache';

import { getActor } from '@/lib/auth/session';
import type { OrgRole } from '@/lib/db/schema';
import {
  addMember,
  getOrganizationBySlug,
  removeMember,
  updateMemberRole,
} from '@/lib/repositories/organizations';

/**
 * Team management actions.
 *
 * Each resolves the organisation from its slug and then hands the id to a
 * repository function that authorizes independently. The slug in the URL is
 * therefore untrusted input — being able to name an organisation grants
 * nothing.
 */

export interface TeamActionState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

async function organizationIdFor(slug: string): Promise<string | null> {
  const actor = await getActor();
  const org = await getOrganizationBySlug(actor, slug);
  return org.ok ? org.data.id : null;
}

export async function inviteMemberAction(
  slug: string,
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const actor = await getActor();
  const organizationId = await organizationIdFor(slug);
  if (!organizationId) return { error: 'Not found.' };

  const result = await addMember(actor, organizationId, {
    email: String(formData.get('email') ?? ''),
    orgRole: (formData.get('orgRole') as 'admin' | 'recruiter' | 'viewer') ?? 'viewer',
  });

  if (!result.ok) {
    return {
      error: result.error.message,
      ...(result.error.fields ? { fieldErrors: result.error.fields } : {}),
    };
  }

  revalidatePath(`/organizations/${slug}/team`);
  return { message: 'Invitation sent.' };
}

export async function changeMemberRoleAction(
  slug: string,
  userId: string,
  orgRole: Exclude<OrgRole, 'owner'>,
): Promise<TeamActionState> {
  const actor = await getActor();
  const organizationId = await organizationIdFor(slug);
  if (!organizationId) return { error: 'Not found.' };

  const result = await updateMemberRole(actor, organizationId, userId, orgRole);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/organizations/${slug}/team`);
  return { message: 'Role updated.' };
}

export async function removeMemberAction(
  slug: string,
  userId: string,
): Promise<TeamActionState> {
  const actor = await getActor();
  const organizationId = await organizationIdFor(slug);
  if (!organizationId) return { error: 'Not found.' };

  const result = await removeMember(actor, organizationId, userId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/organizations/${slug}/team`);
  return { message: 'Member removed.' };
}
