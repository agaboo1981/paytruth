import { InvoiceStatus, type Invoice } from './types';

const USDC_DECIMALS = 6;
const USDC_FACTOR = 10n ** BigInt(USDC_DECIMALS);

export function formatUsdc(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / USDC_FACTOR;
  const fraction = (abs % USDC_FACTOR).toString().padStart(USDC_DECIMALS, '0');
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (fraction === '000000') {
    return `${negative ? '-' : ''}${groupedWhole}.00 USDC`;
  }

  const significant = Math.max(2, fraction.replace(/0+$/, '').length);
  const visible = fraction.slice(0, significant);
  return `${negative ? '-' : ''}${groupedWhole}.${visible} USDC`;
}

export function parseUsdc(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;

  const [whole, fraction = ''] = trimmed.split('.');
  const paddedFraction = fraction.padEnd(USDC_DECIMALS, '0');
  try {
    const value = BigInt(whole) * USDC_FACTOR + BigInt(paddedFraction || '0');
    if (value < 0n) return null;
    return value;
  } catch {
    return null;
  }
}

export function decodeMemo(memo: Uint8Array): string {
  let end = memo.length;
  while (end > 0 && memo[end - 1] === 0) end -= 1;
  try {
    return new TextDecoder().decode(memo.subarray(0, end)).trim();
  } catch {
    return '';
  }
}

export type DerivedKind =
  | 'open'
  | 'expiring'
  | 'paid'
  | 'overpaid-refund-due'
  | 'refunded'
  | 'claimed'
  | 'expired'
  | 'closed';

export type DerivedView = {
  kind: DerivedKind;
  excess: bigint;
  canPay: boolean;
  canClaim: boolean;
  canRefund: boolean;
  canExpire: boolean;
  canRecover: boolean;
  canClose: boolean;
  headline: string;
  explanation: string;
};

function excessOf(invoice: Invoice): bigint {
  return invoice.paidAmount > invoice.amountDue ? invoice.paidAmount - invoice.amountDue : 0n;
}

export function derivedView(invoice: Invoice, nowSec: number, escrowBalance: bigint): DerivedView {
  const now = BigInt(Math.floor(nowSec));
  const excess = excessOf(invoice);
  if (invoice.status === InvoiceStatus.Closed) {
    return {
      kind: 'closed',
      excess,
      canPay: false,
      canClaim: false,
      canRefund: false,
      canExpire: false,
      canRecover: false,
      canClose: false,
      headline: 'Closed',
      explanation: 'The merchant closed this invoice after it was settled. Nothing more can happen to it.',
    };
  }
  const isOpen = invoice.status === InvoiceStatus.Open;
  const isPaid = invoice.status === InvoiceStatus.Paid;
  const isExpired = invoice.status === InvoiceStatus.Expired;
  const expiring = isOpen && now >= invoice.expiresAt;

  const vaultEmpty = escrowBalance === 0n;
  const excessCleared = excess === 0n || invoice.refundedExcess === excess;
  const terminal = isExpired || (isPaid && invoice.claimed && excessCleared);

  const canPay = isOpen && now < invoice.expiresAt;
  const canClaim = isPaid && !invoice.claimed;
  const canRefund = isPaid && excess > 0n && invoice.refundedExcess === 0n;
  const canExpire = isOpen && now >= invoice.expiresAt;
  const canRecover = terminal && excessCleared && escrowBalance > 0n;
  const canClose = terminal && excessCleared && vaultEmpty;

  let kind: DerivedKind;
  if (isExpired || (expiring && !isPaid)) {
    kind = 'expired';
  } else if (isOpen) {
    kind = 'open';
  } else if (excess > 0n && invoice.refundedExcess === 0n) {
    // Extra still held in escrow (claimed or not): the refund is the next step.
    kind = 'overpaid-refund-due';
  } else if (!invoice.claimed && excess > 0n) {
    // Extra refunded, amount due still waiting to be claimed.
    kind = 'refunded';
  } else if (!invoice.claimed) {
    kind = 'paid';
  } else {
    kind = 'claimed';
  }

  const copy: Record<DerivedKind, { headline: string; explanation: string }> = {
    open: {
      headline: 'Awaiting payment',
      explanation: 'The invoice is open. Your customer can pay the amount due into escrow.',
    },
    expiring: {
      headline: 'Expired, unpaid',
      explanation: 'The expiry time has passed and no one paid. The invoice can be marked expired.',
    },
    paid: {
      headline: 'Paid, not claimed',
      explanation: 'The customer paid the full amount into escrow. Claim it to move the USDC to your wallet.',
    },
    'overpaid-refund-due': {
      headline: 'Paid with extra',
      explanation: 'The customer paid more than the amount due. The extra is held until it is refunded.',
    },
    refunded: {
      headline: 'Paid and refunded',
      explanation: 'The customer was paid back the extra amount. The amount due is ready to claim.',
    },
    claimed: {
      headline: 'Paid and claimed',
      explanation: 'The amount due has been claimed. Once the vault is empty the invoice can be closed.',
    },
    expired: {
      headline: 'Expired',
      explanation: 'The invoice expired without a valid payment. Any leftover funds can be recovered.',
    },
    closed: {
      headline: 'Closed',
      explanation: 'The merchant closed this invoice after it was settled. Nothing more can happen to it.',
    },
  };

  return {
    kind,
    excess,
    canPay,
    canClaim,
    canRefund,
    canExpire,
    canRecover,
    canClose,
    headline: copy[kind].headline,
    explanation: copy[kind].explanation,
  };
}
