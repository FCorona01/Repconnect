/**
 * Public profile slugs: /r/<slug>
 *
 * A rep's profile URL is meant to be put on LinkedIn and in email signatures,
 * so it must read like a person's name rather than an opaque identifier. It is
 * also immutable once issued (enforced by trigger) — a link that rots is worse
 * than an ugly one.
 *
 * A short random suffix disambiguates the many people who share a name. It is
 * NOT a security measure: the profile's visibility setting controls access, and
 * a guessable slug reveals nothing that visibility does not already allow.
 */

const SUFFIX_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1 — misread when typed
const SUFFIX_LENGTH = 5;
const MAX_BASE_LENGTH = 48;

/**
 * Normalises a display name into slug form.
 *
 * NFKD normalisation splits accented characters into base + combining mark so
 * the marks can be stripped: "José Ramírez" becomes "jose-ramirez" rather than
 * losing the letters entirely.
 */
export function slugifyName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '');

  // Names written entirely in a non-Latin script normalise to nothing. Falling
  // back keeps the URL valid rather than failing the signup.
  return base.length >= 2 ? base : 'rep';
}

function randomSuffix(): string {
  const bytes = new Uint8Array(SUFFIX_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length]).join('');
}

/** A candidate slug. Uniqueness is confirmed against the database by the caller. */
export function generateProfileSlug(fullName: string): string {
  return `${slugifyName(fullName)}-${randomSuffix()}`;
}
