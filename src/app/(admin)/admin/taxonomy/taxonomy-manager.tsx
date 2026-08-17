'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Card, FieldError, FieldLabel, INPUT_CLASS } from '@/components/ui';
import { filterTaxonomyTree, flattenTree } from '@/lib/taxonomy/filter';
import type { TaxonomyNode } from '@/lib/repositories/taxonomy';

import {
  createEntryAction,
  setEntryActiveAction,
  type TaxonomyActionState,
} from './actions';

type Taxonomy = 'industries' | 'product-categories';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Adding…' : label}
    </button>
  );
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Taxonomy administration for one vocabulary.
 *
 * Shows retired entries alongside active ones — they still resolve for profiles
 * that reference them, so hiding them here would make the list disagree with
 * what users actually see.
 */
export function TaxonomyManager({
  taxonomy,
  title,
  nodes,
}: {
  taxonomy: Taxonomy;
  title: string;
  nodes: TaxonomyNode[];
}) {
  const [state, formAction] = useActionState<TaxonomyActionState, FormData>(
    createEntryAction.bind(null, taxonomy),
    {},
  );
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [slug, setSlug] = useState('');
  const [pending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const filtered = useMemo(() => filterTaxonomyTree(nodes, query), [nodes, query]);
  const allNodes = useMemo(() => flattenTree(nodes), [nodes]);

  const effectiveSlug = slugEdited ? slug : slugify(name);

  function toggleActive(entrySlug: string, nextActive: boolean): void {
    setRowError(null);
    startTransition(async () => {
      const result = await setEntryActiveAction(taxonomy, entrySlug, nextActive);
      if (result.error) setRowError(result.error);
    });
  }

  function renderNode(node: TaxonomyNode, depth: number): React.ReactNode {
    return (
      <li key={node.id}>
        <div
          className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 last:border-0"
          style={{ paddingLeft: `${depth * 18}px` }}
        >
          <span className="min-w-0 text-sm">
            <span className={node.isActive ? undefined : 'text-[var(--muted)] line-through'}>
              {node.name}
            </span>
            <code className="ml-2 text-xs text-[var(--muted)]">{node.slug}</code>
          </span>

          <button
            type="button"
            disabled={pending}
            onClick={() => toggleActive(node.slug, !node.isActive)}
            className="shrink-0 text-xs text-[var(--muted)] underline underline-offset-4 disabled:opacity-50"
          >
            {node.isActive ? 'Retire' : 'Reactivate'}
          </button>
        </div>
        {node.children.length > 0 && (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-sm text-[var(--muted)]">{allNodes.length} entries</p>
      </div>

      <form action={formAction} className="mt-4">
        <Card className="space-y-4">
          <p className="text-sm text-[var(--muted)]">
            Adding an entry is safe at any time. It needs no schema change and does not
            affect profiles already using a parent category.
          </p>

          {state.error && <Alert tone="error">{state.error}</Alert>}
          {state.message && <Alert tone="success">{state.message}</Alert>}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <FieldLabel htmlFor={`${taxonomy}-name`}>Name</FieldLabel>
              <input
                id={`${taxonomy}-name`}
                name="name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT_CLASS}
              />
              <FieldError id={`${taxonomy}-name-error`} message={state.fieldErrors?.name} />
            </div>

            <div>
              <FieldLabel htmlFor={`${taxonomy}-slug`} hint="Permanent once created.">
                Slug
              </FieldLabel>
              <input
                id={`${taxonomy}-slug`}
                name="slug"
                required
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(slugify(e.target.value));
                }}
                className={INPUT_CLASS}
              />
              <FieldError id={`${taxonomy}-slug-error`} message={state.fieldErrors?.slug} />
            </div>

            <div>
              <FieldLabel htmlFor={`${taxonomy}-parent`} hint="Leave blank for a top level entry.">
                Parent
              </FieldLabel>
              <select id={`${taxonomy}-parent`} name="parentSlug" className={INPUT_CLASS}>
                <option value="">None (top level)</option>
                {allNodes.map((node) => (
                  <option key={node.id} value={node.slug}>
                    {'— '.repeat(Math.max(0, node.depth - 1))}
                    {node.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Submit label="Add entry" />
        </Card>
      </form>

      <div className="mt-6">
        <label htmlFor={`${taxonomy}-search`} className="sr-only">
          Search {title}
        </label>
        <input
          id={`${taxonomy}-search`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className={INPUT_CLASS}
        />
      </div>

      {rowError && (
        <div className="mt-3">
          <Alert tone="error">{rowError}</Alert>
        </div>
      )}

      <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">No matches.</p>
        ) : (
          <ul>{filtered.map((node) => renderNode(node, 0))}</ul>
        )}
      </div>
    </section>
  );
}
