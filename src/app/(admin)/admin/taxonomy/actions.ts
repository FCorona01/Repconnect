'use server';

import { revalidatePath } from 'next/cache';

import { getActor } from '@/lib/auth/session';
import {
  createTaxonomyEntry,
  setTaxonomyEntryActive,
} from '@/lib/repositories/taxonomy';

export interface TaxonomyActionState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

type Taxonomy = 'industries' | 'product-categories';

/**
 * Taxonomy administration.
 *
 * This is the mechanism that keeps RepConnect industry-agnostic over time:
 * growing the vocabulary is an INSERT, at any depth, with no schema change and
 * no migration of the profiles already referencing a parent.
 */
export async function createEntryAction(
  taxonomy: Taxonomy,
  _previous: TaxonomyActionState,
  formData: FormData,
): Promise<TaxonomyActionState> {
  const actor = await getActor();

  const parentSlug = String(formData.get('parentSlug') ?? '').trim();

  const result = await createTaxonomyEntry(actor, taxonomy, {
    slug: String(formData.get('slug') ?? ''),
    name: String(formData.get('name') ?? ''),
    ...(parentSlug ? { parentSlug } : {}),
  });

  if (!result.ok) {
    return {
      error: result.error.message,
      ...(result.error.fields ? { fieldErrors: result.error.fields } : {}),
    };
  }

  revalidatePath('/admin/taxonomy');
  return { message: `Added "${result.data.slug}".` };
}

export async function setEntryActiveAction(
  taxonomy: Taxonomy,
  slug: string,
  isActive: boolean,
): Promise<TaxonomyActionState> {
  const actor = await getActor();

  const result = await setTaxonomyEntryActive(actor, taxonomy, slug, isActive);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/admin/taxonomy');
  return { message: isActive ? 'Reactivated.' : 'Retired.' };
}
