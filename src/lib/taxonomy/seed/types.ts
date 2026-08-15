/**
 * Source of truth for the seeded taxonomy.
 *
 * These files are compiled into supabase/migrations/0008_taxonomy_seed.sql by
 * scripts/generate-taxonomy-seed.ts. They are build-time data, not runtime
 * data — at runtime the database is authoritative, because administrators can
 * add and retire entries without a deploy.
 *
 * ADDING TO THE TAXONOMY LATER
 * ----------------------------
 * Growth is INSERT-only. A new industry, a new sub-category, or an entire new
 * branch is an addition to these lists (or a row added through the admin
 * console) — never a schema change, and never a migration of user data.
 * Hierarchy depth is unbounded: `path` is derived by trigger from `parent_id`,
 * so a third or fourth level costs nothing.
 *
 * WHAT MUST NOT CHANGE
 * --------------------
 * `slug` is a permanent contract. It appears in URLs, in application code and
 * in this seed. The database refuses to change one. To retire an entry, set
 * is_active = false — never delete it, or profiles referencing it break.
 */

export interface FlatEntry {
  slug: string;
  name: string;
  description?: string;
}

export interface CompensationEntry extends FlatEntry {
  /**
   * Whether the arrangement includes money that is not contingent on closing.
   * Used as a hard gate in matching: a rep who requires guaranteed pay is
   * never shown commission-only work, however well it matches otherwise.
   */
  hasGuaranteedPay: boolean;
}

export interface TreeNode {
  slug: string;
  name: string;
  description?: string;
  children?: TreeNode[];
}
