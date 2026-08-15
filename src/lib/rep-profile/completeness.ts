/**
 * Profile completeness scoring.
 *
 * A pure function with no database or framework dependency, so it is testable
 * in isolation and cheap to change.
 *
 * It is not decoration. Completeness drives ranking in the rep directory
 * (Phase 4) and match quality (Phase 7), because an incomplete profile cannot
 * be matched well no matter how good the rep is. Showing a rep exactly what is
 * missing, and what it is worth, is the most effective way to get profiles
 * finished — which is the single biggest lever on marketplace liquidity.
 *
 * The weights encode a judgement: attributes that make MATCHING possible are
 * worth far more than attributes that make a profile look nice. Industries and
 * territories together are 30% because without them a rep is essentially
 * unmatchable; an avatar is 5% because it affects only presentation.
 */

export interface CompletenessInput {
  headline: string | null;
  bio: string | null;
  yearsExperience: number | null;
  seniority: string | null;
  avatarFileId: string | null;
  linkedinUrl: string | null;
  industryCount: number;
  territoryCount: number;
  customerTypeCount: number;
  salesModelCount: number;
  compensationPrefCount: number;
}

export interface CompletenessFactor {
  key: string;
  label: string;
  weight: number;
  complete: boolean;
  /** Shown to the rep when incomplete. Actionable, never a scolding. */
  hint: string;
}

export interface CompletenessResult {
  score: number;
  factors: CompletenessFactor[];
  missing: CompletenessFactor[];
}

const MIN_BIO_LENGTH = 80;

export function scoreProfileCompleteness(
  input: CompletenessInput,
): CompletenessResult {
  const factors: CompletenessFactor[] = [
    {
      key: 'headline',
      label: 'Headline',
      weight: 10,
      complete: (input.headline?.trim().length ?? 0) > 0,
      hint: 'One line on what you sell and to whom.',
    },
    {
      key: 'industries',
      label: 'Industries',
      weight: 15,
      complete: input.industryCount > 0,
      hint: 'Without at least one industry, businesses cannot find you.',
    },
    {
      key: 'territories',
      label: 'Territories',
      weight: 15,
      complete: input.territoryCount > 0,
      hint: 'Add the areas you cover — or Nationwide if you work anywhere.',
    },
    {
      key: 'bio',
      label: 'About you',
      weight: 15,
      // A three-word bio is technically present and practically useless, so
      // presence alone is not the test.
      complete: (input.bio?.trim().length ?? 0) >= MIN_BIO_LENGTH,
      hint: 'A short paragraph on your track record. Aim for a few sentences.',
    },
    {
      key: 'customerTypes',
      label: 'Customer types',
      weight: 10,
      complete: input.customerTypeCount > 0,
      hint: 'Enterprise and SMB selling are different jobs. Say which you do.',
    },
    {
      key: 'salesModels',
      label: 'Sales models',
      weight: 10,
      complete: input.salesModelCount > 0,
      hint: 'Field or inside? Hunting or account management?',
    },
    {
      key: 'compensation',
      label: 'Compensation preferences',
      weight: 10,
      complete: input.compensationPrefCount > 0,
      hint: 'So you are only shown arrangements that work for you.',
    },
    {
      key: 'experience',
      label: 'Experience level',
      weight: 5,
      complete: input.yearsExperience !== null && input.seniority !== null,
      hint: 'Years selling, and the level you operate at.',
    },
    {
      key: 'avatar',
      label: 'Profile photo',
      weight: 5,
      complete: input.avatarFileId !== null,
      hint: 'Profiles with a photo get noticeably more responses.',
    },
    {
      key: 'linkedin',
      label: 'LinkedIn',
      weight: 5,
      complete: (input.linkedinUrl?.trim().length ?? 0) > 0,
      hint: 'Adds credibility for businesses deciding whether to reach out.',
    },
  ];

  const score = factors.reduce((total, f) => (f.complete ? total + f.weight : total), 0);

  return {
    score,
    factors,
    // Highest-value gaps first, so the rep fixes what matters most.
    missing: factors.filter((f) => !f.complete).sort((a, b) => b.weight - a.weight),
  };
}

/** Weights must total 100, or the score is not a percentage. Asserted in tests. */
export const TOTAL_WEIGHT = 100;
