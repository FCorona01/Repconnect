'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import { TaxonomyPicker, type Selection } from '@/components/taxonomy-picker';
import {
  Alert,
  Card,
  CompletenessMeter,
  FieldError,
  FieldLabel,
  INPUT_CLASS,
} from '@/components/ui';
import type { PickerNode } from '@/lib/taxonomy/filter';
import { SENIORITY_LABELS, VISIBILITY_LABELS, type RepVisibility } from '@/lib/db/schema';
import type { RepProfileOwnerView } from '@/lib/repositories/rep-profiles';
import type { FlatTaxonomyEntry, TaxonomyNode } from '@/lib/repositories/taxonomy';

import {
  removeAvatarAction,
  saveProfileStepAction,
  setVisibilityAction,
  uploadAvatarAction,
  type ProfileActionState,
} from './actions';

/**
 * The profile wizard.
 *
 * Chunked into six steps deliberately. A twenty-field wall on a phone is
 * exactly where reps abandon signup, and reps are the scarce side of this
 * marketplace — so the form is built for the phone first and every step saves
 * on its own rather than at the end.
 */

const SENIORITIES = [
  'sdr',
  'ae',
  'senior_ae',
  'enterprise_ae',
  'sales_manager',
  'director',
  'vp',
  'cro',
] as const;

const VISIBILITIES: RepVisibility[] = ['public', 'businesses_only', 'applied_only'];

interface Vocabularies {
  industries: TaxonomyNode[];
  productCategories: TaxonomyNode[];
  territories: Array<TaxonomyNode & { kind: string }>;
  customerTypes: FlatTaxonomyEntry[];
  salesModels: FlatTaxonomyEntry[];
  compensationTypes: Array<FlatTaxonomyEntry & { hasGuaranteedPay: boolean }>;
}

/** Flat vocabularies render through the same picker as a one-level tree. */
function asNodes(entries: FlatTaxonomyEntry[]): PickerNode[] {
  return entries.map((entry) => ({
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    description: entry.description,
    isActive: entry.isActive,
    children: [],
  }));
}

const STEPS = [
  { key: 'basics', title: 'About you' },
  { key: 'expertise', title: 'What you sell' },
  { key: 'territories', title: 'Where you sell' },
  { key: 'approach', title: 'How you sell' },
  { key: 'terms', title: 'Terms' },
  { key: 'visibility', title: 'Visibility' },
] as const;

export function ProfileWizard({
  existing,
  avatarUrl,
  vocabularies,
}: {
  existing: RepProfileOwnerView | null;
  avatarUrl: string | null;
  vocabularies: Vocabularies;
}) {
  const [step, setStep] = useState(0);
  const [saving, startSaving] = useTransition();
  const [state, setState] = useState<ProfileActionState>({});

  // Form state
  const [headline, setHeadline] = useState(existing?.headline ?? '');
  const [bio, setBio] = useState(existing?.bio ?? '');
  const [yearsExperience, setYears] = useState(
    existing?.yearsExperience !== null && existing?.yearsExperience !== undefined
      ? String(existing.yearsExperience)
      : '',
  );
  const [seniority, setSeniority] = useState(existing?.seniority ?? '');
  const [linkedinUrl, setLinkedin] = useState(existing?.linkedinUrl ?? '');

  const [industries, setIndustries] = useState<Selection[]>(
    existing?.industries.map((i) => ({ slug: i.slug, proficiency: i.proficiency })) ?? [],
  );
  const [productCategories, setCategories] = useState<Selection[]>(
    existing?.productCategories.map((i) => ({ slug: i.slug, proficiency: i.proficiency })) ??
      [],
  );
  const [territories, setTerritories] = useState<Selection[]>(
    existing?.territories.map((t) => ({ slug: t.slug })) ?? [],
  );
  const [customerTypes, setCustomerTypes] = useState<Selection[]>(
    existing?.customerTypes.map((c) => ({ slug: c.slug, proficiency: c.proficiency })) ?? [],
  );
  const [salesModels, setSalesModels] = useState<Selection[]>(
    existing?.salesModels.map((s) => ({ slug: s.slug, proficiency: s.proficiency })) ?? [],
  );
  const [compensationTypes, setCompensation] = useState<Selection[]>(
    existing?.compensationTypes.map((c) => ({ slug: c.slug })) ?? [],
  );

  const [minBase, setMinBase] = useState(
    existing?.minBaseRequired ? String(Number(existing.minBaseRequired)) : '',
  );
  const [hours, setHours] = useState(
    existing?.availabilityHoursPerWeek ? String(existing.availabilityHoursPerWeek) : '',
  );
  const [startDate, setStartDate] = useState(existing?.earliestStartDate ?? '');
  const [visibility, setVisibility] = useState<RepVisibility>(
    existing?.visibility ?? 'businesses_only',
  );

  function currentInput() {
    return {
      headline: headline.trim(),
      bio: bio.trim() || null,
      yearsExperience: yearsExperience === '' ? null : Number(yearsExperience),
      seniority: (seniority || null) as (typeof SENIORITIES)[number] | null,
      linkedinUrl: linkedinUrl.trim() || null,
      availabilityHoursPerWeek: hours === '' ? null : Number(hours),
      earliestStartDate: startDate || null,
      minBaseRequired: minBase === '' ? null : Number(minBase),
      industries,
      productCategories,
      territories,
      customerTypes,
      salesModels,
      compensationTypes,
    };
  }

  function save(then?: () => void): void {
    setState({});
    startSaving(async () => {
      const result = await saveProfileStepAction(currentInput());
      setState(result);
      if (!result.error) then?.();
    });
  }

  const isLastStep = step === STEPS.length - 1;
  const canAdvance = headline.trim().length > 0;

  return (
    <div className="space-y-6">
      {existing && (
        <CompletenessMeter
          score={existing.completeness.score}
          missing={existing.completeness.missing}
        />
      )}

      {/* Progress. Tapping a step is allowed only once a profile exists, since
          the headline must be saved before anything else can attach to it. */}
      <nav aria-label="Profile steps">
        <ol className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
          {STEPS.map((s, index) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => existing && setStep(index)}
                disabled={!existing}
                aria-current={index === step ? 'step' : undefined}
                className={
                  index === step
                    ? 'rounded-full bg-[var(--color-brand-600)] px-3 py-1.5 font-medium text-white'
                    : 'rounded-full px-3 py-1.5 text-[var(--muted)] disabled:opacity-50'
                }
              >
                {index + 1}. {s.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.savedAt && !state.error && <Alert tone="success">Saved.</Alert>}

      <Card>
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <FieldLabel htmlFor="headline" hint="One line on what you sell and to whom.">
                Headline
              </FieldLabel>
              <input
                id="headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={160}
                required
                placeholder="Enterprise MedTech closer, Southwest"
                aria-describedby="headline-error"
                className={INPUT_CLASS}
              />
              <FieldError id="headline-error" message={state.fieldErrors?.headline} />
            </div>

            <div>
              <FieldLabel
                htmlFor="bio"
                hint="A short paragraph on your track record. A few sentences is enough."
              >
                About you
              </FieldLabel>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={5}
                maxLength={5000}
                className={INPUT_CLASS}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="years">Years selling</FieldLabel>
                <input
                  id="years"
                  type="number"
                  min={0}
                  max={60}
                  inputMode="numeric"
                  value={yearsExperience}
                  onChange={(e) => setYears(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="seniority">Level</FieldLabel>
                <select
                  id="seniority"
                  value={seniority}
                  onChange={(e) => setSeniority(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">Not specified</option>
                  {SENIORITIES.map((level) => (
                    <option key={level} value={level}>
                      {SENIORITY_LABELS[level]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="linkedin">LinkedIn</FieldLabel>
              <input
                id="linkedin"
                type="url"
                value={linkedinUrl}
                onChange={(e) => setLinkedin(e.target.value)}
                placeholder="https://linkedin.com/in/you"
                className={INPUT_CLASS}
              />
              <FieldError id="linkedin-error" message={state.fieldErrors?.linkedinUrl} />
            </div>

            {existing && <AvatarField avatarUrl={avatarUrl} />}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-8">
            <TaxonomyPicker
              label="Industries"
              hint="The markets you have sold into. Pick the closest match if yours is not listed exactly."
              nodes={vocabularies.industries}
              value={industries}
              onChange={setIndustries}
              withProficiency
              max={30}
            />
            <TaxonomyPicker
              label="What you sell"
              hint="The kind of thing, rather than the market. Capital equipment sells differently from software."
              nodes={vocabularies.productCategories}
              value={productCategories}
              onChange={setCategories}
              withProficiency
              max={30}
            />
          </div>
        )}

        {step === 2 && (
          <TaxonomyPicker
            label="Territories"
            hint="Pick a country for nationwide, or the root for fully remote. Selecting a state covers every metro inside it."
            nodes={vocabularies.territories}
            value={territories}
            onChange={setTerritories}
            max={60}
          />
        )}

        {step === 3 && (
          <div className="space-y-8">
            <TaxonomyPicker
              label="Who you sell to"
              hint="Enterprise and SMB selling are different jobs. Say which you do."
              nodes={asNodes(vocabularies.customerTypes)}
              value={customerTypes}
              onChange={setCustomerTypes}
              withProficiency
              max={15}
            />
            <TaxonomyPicker
              label="How you sell"
              nodes={asNodes(vocabularies.salesModels)}
              value={salesModels}
              onChange={setSalesModels}
              withProficiency
              max={15}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-8">
            <TaxonomyPicker
              label="Arrangements you are open to"
              hint="You will only be shown opportunities that match these."
              nodes={asNodes(vocabularies.compensationTypes)}
              value={compensationTypes}
              onChange={setCompensation}
              max={10}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel
                  htmlFor="minBase"
                  hint="Leave blank if you are open to commission-only."
                >
                  Minimum base required
                </FieldLabel>
                <input
                  id="minBase"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={minBase}
                  onChange={(e) => setMinBase(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="hours" hint="For fractional or part-time work.">
                  Hours available per week
                </FieldLabel>
                <input
                  id="hours"
                  type="number"
                  min={1}
                  max={80}
                  inputMode="numeric"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="startDate">Earliest start date</FieldLabel>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <p className="text-xs text-[var(--muted)]">
              Your minimum base and start date are never shown on your public page. They
              are used to filter what you are shown.
            </p>
          </div>
        )}

        {step === 5 && (
          <VisibilityStep
            value={visibility}
            onChange={setVisibility}
            hasProfile={Boolean(existing)}
            slug={existing?.slug ?? null}
          />
        )}
      </Card>

      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || saving}
          className="text-sm text-[var(--muted)] underline disabled:opacity-40"
        >
          Back
        </button>

        <div className="flex items-center gap-3">
          {!canAdvance && (
            <span className="text-xs text-[var(--muted)]">A headline is required</span>
          )}
          <button
            type="button"
            onClick={() => save(isLastStep ? undefined : () => setStep((s) => s + 1))}
            disabled={saving || !canAdvance}
            className="rounded-lg bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : isLastStep ? 'Save' : 'Save and continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Visibility gets its own step and plain-language descriptions.
 *
 * It is the field that decides whether a rep's current employer can discover
 * they are looking, so it is never a checkbox tucked under "advanced".
 */
function VisibilityStep({
  value,
  onChange,
  hasProfile,
  slug,
}: {
  value: RepVisibility;
  onChange: (next: RepVisibility) => void;
  hasProfile: boolean;
  slug: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(next: RepVisibility): void {
    onChange(next);
    if (!hasProfile) return;
    setError(null);
    start(async () => {
      const result = await setVisibilityAction(next);
      if (result.error) setError(result.error);
    });
  }

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium">Who can see your profile</legend>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="space-y-3">
        {VISIBILITIES.map((option) => (
          <label
            key={option}
            className={
              value === option
                ? 'flex cursor-pointer gap-3 rounded-lg border border-[var(--color-brand-500)] bg-[var(--color-brand-500)]/8 p-4'
                : 'flex cursor-pointer gap-3 rounded-lg border border-[var(--border)] p-4'
            }
          >
            <input
              type="radio"
              name="visibility"
              value={option}
              checked={value === option}
              onChange={() => choose(option)}
              disabled={pending}
              className="mt-0.5 size-4 accent-[var(--color-brand-600)]"
            />
            <span className="text-sm">{VISIBILITY_LABELS[option]}</span>
          </label>
        ))}
      </div>

      {value === 'public' && (
        <Alert tone="warning">
          A public profile can be found by search engines, including by your current
          employer. Choose &ldquo;Businesses only&rdquo; if that matters.
        </Alert>
      )}

      {hasProfile && slug && (
        <p className="text-xs text-[var(--muted)]">
          Your page is at <code>/r/{slug}</code>. That address never changes.
        </p>
      )}
    </fieldset>
  );
}

function AvatarSubmit() {
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

function AvatarField({ avatarUrl }: { avatarUrl: string | null }) {
  const [state, formAction] = useActionState<ProfileActionState, FormData>(
    uploadAvatarAction,
    {},
  );
  const [removing, startRemoving] = useTransition();

  return (
    <div>
      <FieldLabel htmlFor="avatar" hint="JPEG, PNG or WebP, up to 5 MB.">
        Profile photo
      </FieldLabel>

      {state.error && (
        <p className="mb-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <div className="flex items-center gap-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt="Your current profile photo"
            width={56}
            height={56}
            className="size-14 rounded-xl object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="size-14 rounded-xl border border-dashed border-[var(--border)]"
          />
        )}

        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input
            id="avatar"
            name="avatar"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            className="max-w-[13rem] text-sm"
          />
          <AvatarSubmit />
        </form>

        {avatarUrl && (
          <button
            type="button"
            disabled={removing}
            onClick={() => startRemoving(async () => void (await removeAvatarAction()))}
            className="text-sm text-[var(--muted)] underline disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-[var(--muted)]">
        Location data is stripped from photos automatically.
      </p>
    </div>
  );
}
