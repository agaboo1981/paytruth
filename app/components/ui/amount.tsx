import { cn } from './utils';

type AmountToken = 'SOL' | 'USDC';

export type AmountProps = {
  value: string | bigint;
  token?: AmountToken;
  decimals?: number;
  precision?: number;
  className?: string;
};

const decimalsByToken: Record<AmountToken, number> = { SOL: 9, USDC: 6 };
const precisionByToken: Record<AmountToken, number> = { SOL: 4, USDC: 6 };

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatAmount(
  value: string | bigint,
  token: AmountToken = 'SOL',
  decimals = decimalsByToken[token],
  precision = precisionByToken[token],
): { display: string; exact: string } {
  const raw = typeof value === 'bigint' ? value.toString() : value.trim();
  if (!/^-?\d+$/.test(raw)) {
    return { display: `— ${token}`, exact: `Invalid ${token} amount` };
  }

  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  const visibleFraction = fraction.slice(0, precision).replace(/0+$/, '');
  const sign = negative ? '-' : '';
  const groupedWhole = groupDigits(whole);

  return {
    display: `${sign}${groupedWhole}${visibleFraction ? `.${visibleFraction}` : ''} ${token}`,
    exact: `${sign}${groupedWhole}.${fraction} ${token}`,
  };
}

export function Amount({
  value,
  token = 'SOL',
  decimals,
  precision,
  className,
}: AmountProps) {
  const result = formatAmount(
    value,
    token,
    decimals ?? decimalsByToken[token],
    precision ?? precisionByToken[token],
  );

  return (
    <span className={cn('font-mono tabular-nums text-fg', className)} title={result.exact}>
      <span className="sr-only">{result.exact}</span>
      <span aria-hidden="true">{result.display}</span>
    </span>
  );
}
