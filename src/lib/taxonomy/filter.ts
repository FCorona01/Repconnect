/**
 * Tree filtering for the taxonomy picker.
 *
 * Extracted as pure functions with no React or DOM dependency, because this is
 * where a picker actually succeeds or fails: with 142 industries and 211
 * territories, a rep who cannot find "Medical Devices" in two seconds abandons
 * the field, and an abandoned field is an unmatchable profile.
 */

/**
 * The minimum a node must have for these helpers to work.
 *
 * Kept structural and generic so callers get their OWN node type back rather
 * than a widened one — the admin console needs `depth` on the results, the
 * picker does not, and neither should have to cast.
 */
export interface TreeNodeLike {
  id: string;
  slug: string;
  name: string;
  isActive?: boolean;
}

export type AnyTree<T extends TreeNodeLike> = T & { children: AnyTree<T>[] };

export interface PickerNode extends TreeNodeLike {
  description?: string | null;
  children: PickerNode[];
}

/** Fold accents so "quebec" finds "Québec". */
function normalise(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function matchesNode(node: TreeNodeLike, needle: string): boolean {
  return (
    normalise(node.name).includes(needle) || normalise(node.slug).includes(needle)
  );
}

/**
 * Filters a tree to the nodes matching `query`, keeping enough structure for
 * the result to make sense.
 *
 * Two rules, both deliberate:
 *
 *   - A matching PARENT keeps all of its children. Searching "Healthcare"
 *     should show what is inside it, not just the word itself.
 *   - A matching CHILD keeps its ancestors, as context only. Searching
 *     "Medical Devices" shows it under "Healthcare & Life Sciences", so the
 *     user can see where it sits rather than being handed a flat list of
 *     ambiguous leaf names.
 *
 * An empty query returns the tree unchanged.
 */
export function filterTaxonomyTree<T extends TreeNodeLike & { children: T[] }>(
  nodes: T[],
  query: string,
  options: { activeOnly?: boolean } = {},
): T[] {
  const needle = normalise(query);

  const visit = (node: T): T | null => {
    if (options.activeOnly && node.isActive === false) return null;

    const children = node.children
      .map(visit)
      .filter((child): child is T => child !== null);

    if (needle.length === 0) return { ...node, children };

    if (matchesNode(node, needle)) {
      // Keep the whole subtree beneath a matching parent, minus anything the
      // activeOnly filter removed.
      const kept = options.activeOnly
        ? node.children.map(visit).filter((c): c is T => c !== null)
        : node.children;
      return { ...node, children: kept };
    }

    return children.length > 0 ? { ...node, children } : null;
  };

  return nodes.map(visit).filter((node): node is T => node !== null);
}

/** Every node in the tree, depth-first. Used for counts and lookups. */
export function flattenTree<T extends TreeNodeLike & { children: T[] }>(nodes: T[]): T[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** Slug → node, for resolving a selection back to a display name. */
export function indexBySlug<T extends TreeNodeLike & { children: T[] }>(
  nodes: T[],
): Map<string, T> {
  return new Map(flattenTree(nodes).map((node) => [node.slug, node]));
}

/**
 * Which nodes must be expanded for every match to be visible.
 *
 * A search that finds a deep child is useless if the branch above it is
 * collapsed, so the picker opens exactly the ancestors it needs and no more.
 */
export function slugsToExpand<T extends TreeNodeLike & { children: T[] }>(
  nodes: T[],
): Set<string> {
  const expanded = new Set<string>();

  const visit = (node: T): boolean => {
    const hasVisibleDescendant = node.children.map(visit).some(Boolean);
    if (hasVisibleDescendant) expanded.add(node.slug);
    return hasVisibleDescendant || node.children.length === 0;
  };

  nodes.forEach(visit);
  return expanded;
}

/**
 * Ancestor names for a slug, root first — so a selected chip can read
 * "Healthcare & Life Sciences › Medical Devices" instead of a bare leaf name
 * that could belong anywhere.
 */
export function pathToSlug<T extends TreeNodeLike & { children: T[] }>(
  nodes: T[],
  slug: string,
): string[] {
  const trail: string[] = [];

  const visit = (node: T, ancestors: string[]): boolean => {
    if (node.slug === slug) {
      trail.push(...ancestors, node.name);
      return true;
    }
    return node.children.some((child) => visit(child, [...ancestors, node.name]));
  };

  nodes.some((node) => visit(node, []));
  return trail;
}
