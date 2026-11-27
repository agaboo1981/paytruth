import { Badge, type BadgeProps } from '../badge';
import type { DerivedKind } from '../sdk/format';
import { cn } from '../utils';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const kindMeta: Record<DerivedKind, { badge: string; variant: BadgeVariant; tone: string }> = {
  open: { badge: 'Open', variant: 'pending', tone: 'border-[var(--pending)]' },
  expiring: { badge: 'Expiring', variant: 'warning', tone: 'border-[var(--warning)]' },
  paid: { badge: 'Paid', variant: 'success', tone: 'border-[var(--success)]' },
  'overpaid-refund-due': { badge: 'Refund due', variant: 'warning', tone: 'border-[var(--warning)]' },
  refunded: { badge: 'Refunded', variant: 'pending', tone: 'border-[var(--pending)]' },
  claimed: { badge: 'Claimed', variant: 'success', tone: 'border-[var(--success)]' },
  expired: { badge: 'Expired', variant: 'default', tone: 'border-border' },
};

export function StatusHero({
  kind,
  headline,
  explanation,
  className,
  level = 1,
}: {
  kind: DerivedKind;
  headline: string;
  explanation: string;
  className?: string;
  level?: 1 | 2;
}) {
  const meta = kindMeta[kind];
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section
      className={cn(
        'rounded-lg border-l-4 bg-surface p-5 shadow-panel md:p-7',
        meta.tone,
        className,
      )}
      aria-labelledby={`status-${kind}`}
    >
      <Badge variant={meta.variant}>{meta.badge}</Badge>
      <Heading
        id={`status-${kind}`}
        className="mt-3 font-display text-headline font-bold tracking-[-0.03em] text-fg"
      >
        {headline}
      </Heading>
      <p className="mt-2 max-w-[60ch] text-body text-muted">{explanation}</p>
    </section>
  );
}
