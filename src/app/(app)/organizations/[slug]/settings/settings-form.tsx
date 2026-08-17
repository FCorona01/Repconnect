'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import { TaxonomyPicker, type Selection } from '@/components/taxonomy-picker';
import { Alert, Card, FieldError, FieldLabel, INPUT_CLASS } from '@/components/ui';
import { SIZE_BAND_LABELS, type OrgSizeBand } from '@/lib/db/schema';
import type { OrganizationProfileView } from '@/lib/repositories/organizations';
import type { TaxonomyNode } from '@/lib/repositories/taxonomy';

import {
  removeLogoAction,
  saveOrganizationAction,
  uploadLogoAction,
  type OrgSettingsState,
} from './actions';

const SIZE_BANDS: OrgSizeBand[] = ['1-10', '11-50', '51-200', '201-1000', '1000+'];

/**
 * The company profile editor.
 *
 * A single page rather than a wizard: there are fewer fields than a rep
 * profile, and a business filling this in is typically at a desk rather than on
 * a phone between meetings.
 */
export function OrganizationSettingsForm({
  slug,
  organization,
  logoUrl,
  vocabularies,
}: {
  slug: string;
  organization: OrganizationProfileView;
  logoUrl: string | null;
  vocabularies: {
    industries: TaxonomyNode[];
    productCategories: TaxonomyNode[];
    territories: Array<TaxonomyNode & { kind: string }>;
  };
}) {
  const [saving, startSaving] = useTransition();
  const [state, setState] = useState<OrgSettingsState>({});

  const [displayName, setDisplayName] = useState(organization.displayName);
  const [tagline, setTagline] = useState(organization.tagline ?? '');
  const [description, setDescription] = useState(organization.description ?? '');
  const [website, setWebsite] = useState(organization.website ?? '');
  const [sizeBand, setSizeBand] = useState(organization.sizeBand ?? '');
  const [foundedYear, setFoundedYear] = useState(
    organization.foundedYear ? String(organization.foundedYear) : '',
  );
  const [headquarters, setHeadquarters] = useState<Selection[]>(
    organization.headquarters ? [{ slug: organization.headquarters.slug }] : [],
  );
  const [industries, setIndustries] = useState<Selection[]>(
    organization.industries.map((i) => ({ slug: i.slug })),
  );
  const [productCategories, setCategories] = useState<Selection[]>(
    organization.productCategories.map((c) => ({ slug: c.slug })),
  );

  function save(): void {
    setState({});
    startSaving(async () => {
      const result = await saveOrganizationAction(slug, {
        displayName: displayName.trim(),
        tagline: tagline.trim() || null,
        description: description.trim() || undefined,
        website: website.trim(),
        sizeBand: (sizeBand || null) as OrgSizeBand | null,
        foundedYear: foundedYear === '' ? null : Number(foundedYear),
        // One headquarters, expressed through the same picker as everything
        // else so the interaction is consistent.
        hqTerritorySlug: headquarters[0]?.slug ?? null,
        industries,
        productCategories,
      });
      setState(result);
    });
  }

  return (
    <div className="space-y-6">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.savedAt && !state.error && <Alert tone="success">Saved.</Alert>}

      <Card className="space-y-5">
        <div>
          <FieldLabel htmlFor="displayName">Company name</FieldLabel>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            className={INPUT_CLASS}
          />
          <FieldError id="displayName-error" message={state.fieldErrors?.displayName} />
        </div>

        <div>
          <FieldLabel htmlFor="tagline" hint="One line on what you sell and to whom.">
            Tagline
          </FieldLabel>
          <input
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            maxLength={200}
            placeholder="Surgical implants for outpatient centres"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <FieldLabel htmlFor="description">About the company</FieldLabel>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={5000}
            className={INPUT_CLASS}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <FieldLabel htmlFor="website">Website</FieldLabel>
            <input
              id="website"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className={INPUT_CLASS}
            />
            <FieldError id="website-error" message={state.fieldErrors?.website} />
          </div>
          <div>
            <FieldLabel htmlFor="sizeBand">Company size</FieldLabel>
            <select
              id="sizeBand"
              value={sizeBand}
              onChange={(e) => setSizeBand(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Not specified</option>
              {SIZE_BANDS.map((band) => (
                <option key={band} value={band}>
                  {SIZE_BAND_LABELS[band]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="foundedYear">Founded</FieldLabel>
            <input
              id="foundedYear"
              type="number"
              inputMode="numeric"
              min={1600}
              max={new Date().getUTCFullYear()}
              value={foundedYear}
              onChange={(e) => setFoundedYear(e.target.value)}
              className={INPUT_CLASS}
            />
            <FieldError id="foundedYear-error" message={state.fieldErrors?.foundedYear} />
          </div>
        </div>

        <LogoField slug={slug} logoUrl={logoUrl} />
      </Card>

      <Card>
        <TaxonomyPicker
          label="Headquarters"
          hint="Where the company is based. Sales territories are set per opportunity."
          nodes={vocabularies.territories}
          value={headquarters}
          // A single choice, expressed by replacing rather than appending.
          onChange={(next) => setHeadquarters(next.slice(-1))}
          max={1}
        />
      </Card>

      <Card className="space-y-8">
        <TaxonomyPicker
          label="Industries"
          hint="The markets you sell into. Reps are matched against these."
          nodes={vocabularies.industries}
          value={industries}
          onChange={setIndustries}
          max={20}
        />
        <TaxonomyPicker
          label="What you sell"
          nodes={vocabularies.productCategories}
          value={productCategories}
          onChange={setCategories}
          max={20}
        />
      </Card>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

function LogoSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
    >
      {pending ? 'Uploading…' : 'Upload'}
    </button>
  );
}

function LogoField({ slug, logoUrl }: { slug: string; logoUrl: string | null }) {
  const [state, formAction] = useActionState<OrgSettingsState, FormData>(
    uploadLogoAction.bind(null, slug),
    {},
  );
  const [removing, startRemoving] = useTransition();

  return (
    <div>
      <FieldLabel htmlFor="logo" hint="JPEG, PNG or WebP, up to 5 MB. SVG is not accepted.">
        Logo
      </FieldLabel>

      {state.error && (
        <p className="mb-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Your current logo"
            width={56}
            height={56}
            className="size-14 rounded-xl border border-[var(--border)] bg-white object-contain p-1"
          />
        ) : (
          <div
            aria-hidden="true"
            className="size-14 rounded-xl border border-dashed border-[var(--border)]"
          />
        )}

        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            className="max-w-[13rem] text-sm"
          />
          <LogoSubmit />
        </form>

        {logoUrl && (
          <button
            type="button"
            disabled={removing}
            onClick={() => startRemoving(async () => void (await removeLogoAction(slug)))}
            className="text-sm text-[var(--muted)] underline disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
