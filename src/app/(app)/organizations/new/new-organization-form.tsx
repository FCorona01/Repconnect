'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Card, FieldError, FieldLabel, INPUT_CLASS } from '@/components/ui';

import { createOrganizationAction, type NewOrgState } from './actions';

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Creating…' : 'Create company'}
    </button>
  );
}

export function NewOrganizationForm() {
  const [state, formAction] = useActionState<NewOrgState, FormData>(
    createOrganizationAction,
    {},
  );
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  // The URL name follows the company name until the user takes it over. A slug
  // is permanent once created, so it is shown rather than hidden.
  const effectiveSlug = slugEdited ? slug : slugify(displayName);

  return (
    <form action={formAction} className="space-y-6">
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Card className="space-y-5">
        <div>
          <FieldLabel htmlFor="displayName" hint="The name people know you by.">
            Company name
          </FieldLabel>
          <input
            id="displayName"
            name="displayName"
            required
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={INPUT_CLASS}
          />
          <FieldError id="displayName-error" message={state.fieldErrors?.displayName} />
        </div>

        <div>
          <FieldLabel
            htmlFor="legalName"
            hint="Used for verification and contracts. Never shown publicly."
          >
            Legal name
          </FieldLabel>
          <input
            id="legalName"
            name="legalName"
            required
            maxLength={200}
            className={INPUT_CLASS}
          />
          <FieldError id="legalName-error" message={state.fieldErrors?.legalName} />
        </div>

        <div>
          <FieldLabel htmlFor="slug" hint="This becomes your address and cannot be changed later.">
            URL name
          </FieldLabel>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-[var(--muted)]">/c/</span>
            <input
              id="slug"
              name="slug"
              required
              value={effectiveSlug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(slugify(e.target.value));
              }}
              className={INPUT_CLASS}
            />
          </div>
          <FieldError id="slug-error" message={state.fieldErrors?.slug} />
        </div>

        <div>
          <FieldLabel htmlFor="website">Website</FieldLabel>
          <input
            id="website"
            name="website"
            type="url"
            placeholder="https://example.com"
            className={INPUT_CLASS}
          />
          <FieldError id="website-error" message={state.fieldErrors?.website} />
        </div>
      </Card>

      <Submit />
    </form>
  );
}
