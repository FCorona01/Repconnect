import { describe, expect, it } from 'vitest';

import {
  scoreProfileCompleteness,
  TOTAL_WEIGHT,
  type CompletenessInput,
} from '@/lib/rep-profile/completeness';
import { generateProfileSlug, slugifyName } from '@/lib/rep-profile/slug';

const EMPTY: CompletenessInput = {
  headline: null,
  bio: null,
  yearsExperience: null,
  seniority: null,
  avatarFileId: null,
  linkedinUrl: null,
  industryCount: 0,
  territoryCount: 0,
  customerTypeCount: 0,
  salesModelCount: 0,
  compensationPrefCount: 0,
};

const COMPLETE: CompletenessInput = {
  headline: 'Enterprise MedTech closer, Southwest',
  bio: 'A'.repeat(120),
  yearsExperience: 12,
  seniority: 'enterprise_ae',
  avatarFileId: '01890000-0000-7000-8000-000000000000',
  linkedinUrl: 'https://linkedin.com/in/example',
  industryCount: 3,
  territoryCount: 2,
  customerTypeCount: 2,
  salesModelCount: 2,
  compensationPrefCount: 2,
};

describe('profile completeness', () => {
  it('weights sum to exactly 100, so the score is a real percentage', () => {
    const { factors } = scoreProfileCompleteness(EMPTY);
    const total = factors.reduce((sum, f) => sum + f.weight, 0);
    expect(total).toBe(TOTAL_WEIGHT);
  });

  it('scores an empty profile at zero', () => {
    expect(scoreProfileCompleteness(EMPTY).score).toBe(0);
  });

  it('scores a fully filled profile at 100', () => {
    expect(scoreProfileCompleteness(COMPLETE).score).toBe(100);
  });

  it('never returns a score outside 0–100 for any combination', () => {
    // The stored column has a CHECK constraint on this range; a score outside
    // it would fail the write rather than degrade gracefully.
    const keys = Object.keys(EMPTY) as Array<keyof CompletenessInput>;
    for (const key of keys) {
      const partial = { ...EMPTY, [key]: COMPLETE[key] } as CompletenessInput;
      const { score } = scoreProfileCompleteness(partial);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('treats a token bio as incomplete', () => {
    // "Present" is not the same as "useful". A three-word bio should not earn
    // the same credit as a real one.
    const tokenBio = { ...COMPLETE, bio: 'I sell things.' };
    const result = scoreProfileCompleteness(tokenBio);

    expect(result.score).toBeLessThan(100);
    expect(result.missing.map((f) => f.key)).toContain('bio');
  });

  it('values matchability far above presentation', () => {
    const withIndustries = scoreProfileCompleteness({ ...EMPTY, industryCount: 1 });
    const withAvatar = scoreProfileCompleteness({
      ...EMPTY,
      avatarFileId: '01890000-0000-7000-8000-000000000000',
    });

    // Without industries a rep is essentially unmatchable; without a photo they
    // are merely less appealing. The weights must reflect that.
    expect(withIndustries.score).toBeGreaterThan(withAvatar.score);
  });

  it('lists missing factors highest-value first', () => {
    const { missing } = scoreProfileCompleteness(EMPTY);
    const weights = missing.map((f) => f.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it('gives every factor an actionable hint', () => {
    const { factors } = scoreProfileCompleteness(EMPTY);
    for (const factor of factors) {
      expect(factor.hint.length).toBeGreaterThan(10);
      expect(factor.label.length).toBeGreaterThan(0);
    }
  });
});

describe('profile slugs', () => {
  it('produces a readable slug from a name', () => {
    expect(slugifyName('Jane Doe')).toBe('jane-doe');
    expect(slugifyName('  Mary-Jane   Watson  ')).toBe('mary-jane-watson');
  });

  it('preserves accented letters rather than dropping them', () => {
    // NFKD splits the accent off so the base letter survives. Losing letters
    // entirely would turn "José Ramírez" into something unrecognisable.
    expect(slugifyName('José Ramírez')).toBe('jose-ramirez');
    expect(slugifyName('Zoë Müller')).toBe('zoe-muller');
  });

  it('falls back rather than producing an invalid slug for non-Latin names', () => {
    expect(slugifyName('张伟')).toBe('rep');
    expect(slugifyName('!!!')).toBe('rep');
  });

  it('never emits a leading, trailing or doubled hyphen', () => {
    for (const name of ['---Jane---', 'A  B', '.Jane.', 'Jane   ']) {
      const slug = slugifyName(name);
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('generated slugs satisfy the database format constraint', () => {
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (let i = 0; i < 200; i += 1) {
      const slug = generateProfileSlug('Jane Doe');
      expect(slug).toMatch(pattern);
      expect(slug.length).toBeGreaterThanOrEqual(3);
      expect(slug.length).toBeLessThanOrEqual(80);
    }
  });

  it('generates distinct slugs for identical names', () => {
    const slugs = new Set(
      Array.from({ length: 500 }, () => generateProfileSlug('John Smith')),
    );
    // Collisions are handled by retry in the repository, but they should be
    // rare enough that retry is nearly never needed.
    expect(slugs.size).toBeGreaterThan(495);
  });
});
