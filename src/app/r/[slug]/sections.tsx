import { PROFICIENCY_LABELS, type RepProficiency } from '@/lib/db/schema';
import type { RepAttribute, RepTerritoryView } from '@/lib/repositories/rep-profiles';

export function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Expert-level attributes are visually emphasised. A flat list of thirty
 * equally-weighted tags tells a reader nothing; the point of recording
 * proficiency is that it should change what the reader sees.
 */
export function AttributeList({
  items,
  showProficiency = false,
}: {
  items: RepAttribute[];
  showProficiency?: boolean;
}) {
  const sorted = [...items].sort((a, b) => rank(b.proficiency) - rank(a.proficiency));

  return (
    <ul className="flex flex-wrap gap-2">
      {sorted.map((item) => {
        const expert = item.proficiency === 'expert';
        return (
          <li key={item.id}>
            <span
              className={
                expert
                  ? 'inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-brand-500)]/35 bg-[var(--color-brand-500)]/10 px-3 py-1.5 text-sm font-medium'
                  : 'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm'
              }
            >
              {item.name}
              {showProficiency && item.proficiency && (
                <span className="text-xs text-[var(--muted)]">
                  {item.years != null
                    ? `${item.years}y`
                    : PROFICIENCY_LABELS[item.proficiency as RepProficiency]}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function rank(proficiency: RepProficiency | undefined): number {
  switch (proficiency) {
    case 'expert':
      return 3;
    case 'experienced':
      return 2;
    case 'familiar':
      return 1;
    default:
      return 0;
  }
}

/**
 * Territories show their ancestry ("California › Los Angeles Metro") so a
 * reader unfamiliar with a metro name can still place it geographically.
 * The immediate parent is enough; the full chain to "Anywhere" is noise.
 */
export function TerritoryList({ items }: { items: RepTerritoryView[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((territory) => {
        const parent = territory.ancestors.at(-1);
        const showParent = parent && territory.kind === 'metro';

        return (
          <li key={territory.id}>
            <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm">
              {showParent && (
                <span className="text-xs text-[var(--muted)]">{parent} ›</span>
              )}
              {territory.name}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
