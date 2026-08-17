'use client';

import { useId, useMemo, useState } from 'react';

import {
  filterTaxonomyTree,
  indexBySlug,
  pathToSlug,
  slugsToExpand,
  type PickerNode,
} from '@/lib/taxonomy/filter';

/**
 * Hierarchical multi-select over a controlled vocabulary.
 *
 * The single most-used control in the product: industries, product categories
 * and territories all run through it, and a rep who cannot find their industry
 * in a few seconds leaves the field empty — which makes them unmatchable.
 *
 * Design decisions that follow from that:
 *   - search is the primary interaction, the tree is the fallback
 *   - a matching child is shown UNDER its parent, so leaf names that are
 *     ambiguous on their own ("Charleston", "Portland") have context
 *   - selections stay visible as removable chips, so the user always knows what
 *     they have picked without scrolling the list
 *   - nothing collapses a branch the user opened by hand
 */

export interface Selection {
  slug: string;
  proficiency?: 'familiar' | 'experienced' | 'expert';
}

const PROFICIENCIES = ['familiar', 'experienced', 'expert'] as const;

const PROFICIENCY_LABELS: Record<(typeof PROFICIENCIES)[number], string> = {
  familiar: 'Familiar',
  experienced: 'Experienced',
  expert: 'Expert',
};

export function TaxonomyPicker({
  label,
  hint,
  nodes,
  value,
  onChange,
  withProficiency = false,
  max,
  emptyHint = 'No matches. Try a broader word.',
}: {
  label: string;
  hint?: string;
  nodes: PickerNode[];
  value: Selection[];
  onChange: (next: Selection[]) => void;
  withProficiency?: boolean;
  max?: number;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState('');
  const [manuallyOpened, setManuallyOpened] = useState<Set<string>>(new Set());
  const searchId = useId();

  const bySlug = useMemo(() => indexBySlug(nodes), [nodes]);

  const filtered = useMemo(
    () => filterTaxonomyTree(nodes, query, { activeOnly: true }),
    [nodes, query],
  );

  // While searching, open exactly the branches needed to reveal matches. With
  // no query, only what the user opened themselves stays open.
  const autoOpen = useMemo(
    () => (query.trim().length > 0 ? slugsToExpand(filtered) : new Set<string>()),
    [filtered, query],
  );

  const selectedSlugs = useMemo(() => new Set(value.map((v) => v.slug)), [value]);
  const atLimit = max !== undefined && value.length >= max;

  function toggle(slug: string): void {
    if (selectedSlugs.has(slug)) {
      onChange(value.filter((v) => v.slug !== slug));
      return;
    }
    if (atLimit) return;
    onChange([...value, withProficiency ? { slug, proficiency: 'experienced' } : { slug }]);
  }

  function setProficiency(slug: string, proficiency: Selection['proficiency']): void {
    onChange(value.map((v) => (v.slug === slug ? { ...v, proficiency } : v)));
  }

  function toggleOpen(slug: string): void {
    setManuallyOpened((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function renderNode(node: PickerNode, depth: number): React.ReactNode {
    const isSelected = selectedSlugs.has(node.slug);
    const hasChildren = node.children.length > 0;
    const isOpen = autoOpen.has(node.slug) || manuallyOpened.has(node.slug);

    return (
      <li key={node.id}>
        <div
          className="flex items-center gap-2 py-1"
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleOpen(node.slug)}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
              className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--muted)]"
            >
              <span aria-hidden="true" className={isOpen ? 'rotate-90' : ''}>
                ›
              </span>
            </button>
          ) : (
            <span aria-hidden="true" className="size-6 shrink-0" />
          )}

          <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggle(node.slug)}
              // A limit should stop new selections without freezing the ones
              // already made — otherwise the user cannot correct a mistake.
              disabled={!isSelected && atLimit}
              className="size-4 shrink-0 accent-[var(--color-brand-600)] disabled:opacity-40"
            />
            <span className={isSelected ? 'font-medium' : undefined}>{node.name}</span>
          </label>
        </div>

        {hasChildren && isOpen && (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  }

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium">{label}</legend>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}

      {/* Selections first: what you have chosen matters more than the list. */}
      {value.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {value.map((selection) => {
            const node = bySlug.get(selection.slug);
            const trail = pathToSlug(nodes, selection.slug);
            const parent = trail.length > 1 ? trail[trail.length - 2] : null;

            return (
              <li
                key={selection.slug}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-brand-500)]/35 bg-[var(--color-brand-500)]/10 py-1.5 pr-1.5 pl-3 text-sm"
              >
                <span className="min-w-0">
                  {parent && (
                    <span className="text-xs text-[var(--muted)]">{parent} › </span>
                  )}
                  {node?.name ?? selection.slug}
                </span>

                {withProficiency && (
                  <>
                    <label className="sr-only" htmlFor={`prof-${selection.slug}`}>
                      Experience level for {node?.name ?? selection.slug}
                    </label>
                    <select
                      id={`prof-${selection.slug}`}
                      value={selection.proficiency ?? 'experienced'}
                      onChange={(event) =>
                        setProficiency(
                          selection.slug,
                          event.target.value as Selection['proficiency'],
                        )
                      }
                      className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-xs"
                    >
                      {PROFICIENCIES.map((level) => (
                        <option key={level} value={level}>
                          {PROFICIENCY_LABELS[level]}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => toggle(selection.slug)}
                  aria-label={`Remove ${node?.name ?? selection.slug}`}
                  className="flex size-6 items-center justify-center rounded text-[var(--muted)]"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3">
        <label htmlFor={searchId} className="sr-only">
          Search {label}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm"
        />
      </div>

      {atLimit && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          You have selected the maximum of {max}. Remove one to add another.
        </p>
      )}

      <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-[var(--muted)]">{emptyHint}</p>
        ) : (
          <ul>{filtered.map((node) => renderNode(node, 0))}</ul>
        )}
      </div>
    </fieldset>
  );
}
