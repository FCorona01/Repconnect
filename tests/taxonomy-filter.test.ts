import { describe, expect, it } from 'vitest';

import {
  filterTaxonomyTree,
  flattenTree,
  indexBySlug,
  pathToSlug,
  slugsToExpand,
  type PickerNode,
} from '@/lib/taxonomy/filter';

/**
 * The picker's search behaviour.
 *
 * Worth testing carefully: with 142 industries and 211 territories, a rep who
 * cannot find their industry in a couple of seconds leaves the field empty —
 * and an empty field makes the whole profile unmatchable.
 */

const node = (
  slug: string,
  name: string,
  children: PickerNode[] = [],
  isActive = true,
): PickerNode => ({ id: slug, slug, name, isActive, children });

const TREE: PickerNode[] = [
  node('healthcare', 'Healthcare & Life Sciences', [
    node('medical-devices', 'Medical Devices'),
    node('pharmaceuticals', 'Pharmaceuticals'),
    node('dental', 'Dental', [node('dental-implants', 'Dental Implants')]),
  ]),
  node('software', 'Software & Technology', [
    node('b2b-saas', 'B2B SaaS'),
    node('cybersecurity', 'Cybersecurity'),
  ]),
  node('retired-branch', 'Retired Branch', [node('retired-child', 'Retired Child')], false),
];

describe('filterTaxonomyTree', () => {
  it('returns the tree unchanged for an empty query', () => {
    const result = filterTaxonomyTree(TREE, '');
    expect(result).toHaveLength(3);
    expect(result[0]?.children).toHaveLength(3);
  });

  it('keeps the whole subtree when a PARENT matches', () => {
    // Searching a category should show what is inside it, not just the word.
    const result = filterTaxonomyTree(TREE, 'Healthcare');
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe('healthcare');
    expect(result[0]?.children.map((c) => c.slug)).toEqual([
      'medical-devices',
      'pharmaceuticals',
      'dental',
    ]);
  });

  it('keeps ancestors as context when a CHILD matches', () => {
    // "Medical Devices" appears under "Healthcare", so an ambiguous leaf name
    // is never presented without the branch it belongs to.
    const result = filterTaxonomyTree(TREE, 'Medical Devices');
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe('healthcare');
    expect(result[0]?.children).toHaveLength(1);
    expect(result[0]?.children[0]?.slug).toBe('medical-devices');
  });

  it('finds a grandchild and keeps the full chain', () => {
    const result = filterTaxonomyTree(TREE, 'implants');
    expect(result[0]?.slug).toBe('healthcare');
    expect(result[0]?.children[0]?.slug).toBe('dental');
    expect(result[0]?.children[0]?.children[0]?.slug).toBe('dental-implants');
  });

  it('matches on slug as well as name', () => {
    const result = filterTaxonomyTree(TREE, 'b2b-saas');
    expect(result[0]?.children[0]?.slug).toBe('b2b-saas');
  });

  it('is case insensitive and ignores surrounding space', () => {
    expect(filterTaxonomyTree(TREE, '  CYBERSECURITY  ')).toHaveLength(1);
  });

  it('folds accents, so "quebec" finds "Québec"', () => {
    const accented = [node('quebec', 'Québec')];
    expect(filterTaxonomyTree(accented, 'quebec')).toHaveLength(1);
    expect(filterTaxonomyTree(accented, 'Québec')).toHaveLength(1);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(filterTaxonomyTree(TREE, 'zzzznope')).toEqual([]);
  });

  it('drops retired entries when activeOnly is set', () => {
    const active = filterTaxonomyTree(TREE, '', { activeOnly: true });
    expect(active.map((n) => n.slug)).not.toContain('retired-branch');

    const all = filterTaxonomyTree(TREE, '');
    expect(all.map((n) => n.slug)).toContain('retired-branch');
  });

  it('drops a retired child from an active parent', () => {
    const tree = [
      node('active-parent', 'Active Parent', [
        node('live', 'Live Child'),
        node('gone', 'Gone Child', [], false),
      ]),
    ];
    const result = filterTaxonomyTree(tree, '', { activeOnly: true });
    expect(result[0]?.children.map((c) => c.slug)).toEqual(['live']);
  });

  it('does not mutate the input tree', () => {
    const before = JSON.stringify(TREE);
    filterTaxonomyTree(TREE, 'dental', { activeOnly: true });
    expect(JSON.stringify(TREE)).toBe(before);
  });

  it('preserves the caller\'s node type rather than widening it', () => {
    // The admin console needs extra fields on the results; the picker does not.
    // Neither should have to cast.
    interface Rich extends PickerNode {
      depth: number;
      children: Rich[];
    }
    const rich: Rich[] = [
      { id: 'a', slug: 'a', name: 'Alpha', isActive: true, depth: 1, children: [] },
    ];
    const result = filterTaxonomyTree(rich, 'alpha');
    expect(result[0]?.depth).toBe(1);
  });
});

describe('slugsToExpand', () => {
  it('opens exactly the branches needed to reveal matches', () => {
    const filtered = filterTaxonomyTree(TREE, 'implants');
    const expanded = slugsToExpand(filtered);

    // A match buried two levels down is useless if the branches above it are
    // closed.
    expect(expanded.has('healthcare')).toBe(true);
    expect(expanded.has('dental')).toBe(true);
    // Nothing unrelated is opened.
    expect(expanded.has('software')).toBe(false);
  });
});

describe('flattenTree and indexBySlug', () => {
  it('walks every node depth-first', () => {
    expect(flattenTree(TREE)).toHaveLength(10);
  });

  it('indexes by slug, including nested nodes', () => {
    const index = indexBySlug(TREE);
    expect(index.get('dental-implants')?.name).toBe('Dental Implants');
    expect(index.get('nope')).toBeUndefined();
  });
});

describe('pathToSlug', () => {
  it('returns the trail from root to the node', () => {
    expect(pathToSlug(TREE, 'dental-implants')).toEqual([
      'Healthcare & Life Sciences',
      'Dental',
      'Dental Implants',
    ]);
  });

  it('returns just the node for a root entry', () => {
    expect(pathToSlug(TREE, 'software')).toEqual(['Software & Technology']);
  });

  it('returns nothing for an unknown slug', () => {
    expect(pathToSlug(TREE, 'nope')).toEqual([]);
  });
});
