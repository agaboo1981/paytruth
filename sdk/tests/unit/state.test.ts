import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  canClaim,
  canClose,
  canExpire,
  canPay,
  canRecover,
  canRefund,
  deriveInvoiceView,
  excessOf,
  expectedRejection,
  isExcessCleared,
  isTerminal,
} from '../../src/state';
import type { PaytruthErrorName } from '../../src/errors';
import { InvoiceStatus, type Invoice } from '../../src/types';

const merchant = new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
const payer = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const EXP = 1_000n;
const NOW_BEFORE = 999n;
const NOW_AT = 1_000n;
const NOW_AFTER = 1_001n;

function inv(overrides: Partial<Invoice> = {}): Invoice {
  return {
    merchant,
    payer: PublicKey.default,
    mint,
    invoiceId: 1n,
    amountDue: 100n,
    paidAmount: 0n,
    refundedExcess: 0n,
    createdAt: 0n,
    expiresAt: EXP,
    status: InvoiceStatus.Open,
    claimed: false,
    bump: 255,
    memo: new Uint8Array(64),
    ...overrides,
  };
}

function paid(overrides: Partial<Invoice> = {}): Invoice {
  return inv({ status: InvoiceStatus.Paid, payer, paidAmount: 100n, ...overrides });
}

function closed(overrides: Partial<Invoice> = {}): Invoice {
  return inv({ status: InvoiceStatus.Closed, ...overrides });
}

describe('excessOf / isExcessCleared / isTerminal', () => {
  it('excessOf is paid - due floored at 0', () => {
    expect(excessOf(paid({ paidAmount: 100n }))).toBe(0n);
    expect(excessOf(paid({ paidAmount: 150n }))).toBe(50n);
    expect(excessOf(inv())).toBe(0n);
  });

  it('isExcessCleared is true when no excess or fully refunded', () => {
    expect(isExcessCleared(paid({ paidAmount: 100n }))).toBe(true);
    expect(isExcessCleared(paid({ paidAmount: 150n, refundedExcess: 0n }))).toBe(false);
    expect(isExcessCleared(paid({ paidAmount: 150n, refundedExcess: 50n }))).toBe(true);
  });

  it('isTerminal: Closed, Expired OR (Paid && claimed && excessCleared)', () => {
    expect(isTerminal(inv())).toBe(false);
    expect(isTerminal(closed())).toBe(true);
    expect(isTerminal(inv({ status: InvoiceStatus.Expired }))).toBe(true);
    expect(isTerminal(paid({ claimed: false }))).toBe(false);
    expect(isTerminal(paid({ claimed: true, paidAmount: 100n }))).toBe(true);
    expect(isTerminal(paid({ claimed: true, paidAmount: 150n, refundedExcess: 0n }))).toBe(false);
    expect(isTerminal(paid({ claimed: true, paidAmount: 150n, refundedExcess: 50n }))).toBe(true);
  });
});

describe('transition predicates (boundaries)', () => {
  it('canPay: Open and now < expires_at', () => {
    expect(canPay(closed(), NOW_BEFORE)).toBe(false);
    expect(canPay(inv(), NOW_BEFORE)).toBe(true);
    expect(canPay(inv(), NOW_AT)).toBe(false); // now == expires_at => not payable
    expect(canPay(inv(), NOW_AFTER)).toBe(false);
    expect(canPay(paid(), NOW_BEFORE)).toBe(false);
    expect(canPay(inv({ status: InvoiceStatus.Expired }), NOW_BEFORE)).toBe(false);
  });

  it('canExpire: Open and now >= expires_at', () => {
    expect(canExpire(closed(), NOW_AFTER)).toBe(false);
    expect(canExpire(inv(), NOW_BEFORE)).toBe(false);
    expect(canExpire(inv(), NOW_AT)).toBe(true);
    expect(canExpire(inv(), NOW_AFTER)).toBe(true);
    expect(canExpire(paid(), NOW_AFTER)).toBe(false);
    expect(canExpire(inv({ status: InvoiceStatus.Expired }), NOW_AFTER)).toBe(false);
  });

  it('Paid invoice after the expiry window is still claimable/refundable, not expirable', () => {
    const p = paid({ paidAmount: 150n });
    expect(canExpire(p, NOW_AFTER)).toBe(false);
    expect(canClaim(p)).toBe(true);
    expect(canRefund(p)).toBe(true);
  });
});

describe('canClaim / canRefund', () => {
  it('canClaim true only when Paid and not claimed', () => {
    expect(canClaim(paid({ claimed: false }))).toBe(true);
    expect(canClaim(paid({ claimed: true }))).toBe(false);
    expect(canClaim(closed())).toBe(false);
    expect(canClaim(inv())).toBe(false);
    expect(canClaim(inv({ status: InvoiceStatus.Expired }))).toBe(false);
  });

  it('canRefund requires Paid, paid>due, refunded_excess==0, payer recorded', () => {
    expect(canRefund(paid({ paidAmount: 150n }))).toBe(true);
    expect(canRefund(paid({ paidAmount: 100n }))).toBe(false);
    expect(canRefund(paid({ paidAmount: 150n, refundedExcess: 50n }))).toBe(false);
    expect(canRefund(paid({ paidAmount: 150n, payer: PublicKey.default }))).toBe(false);
    expect(canRefund(closed({ payer, paidAmount: 150n }))).toBe(false);
    expect(canRefund(inv())).toBe(false);
  });
});

describe('canRecover / canClose', () => {
  it('canRecover: terminal and escrow balance > 0', () => {
    const expired = inv({ status: InvoiceStatus.Expired });
    expect(canRecover(expired, 5n)).toBe(true);
    expect(canRecover(expired, 0n)).toBe(false);
    const terminalPaid = paid({ claimed: true });
    expect(canRecover(terminalPaid, 5n)).toBe(true);
    expect(canRecover(paid({ claimed: true, paidAmount: 150n }), 5n)).toBe(false); // excess outstanding
    expect(canRecover(paid({ claimed: false }), 5n)).toBe(false);
    expect(canRecover(closed(), 5n)).toBe(true); // tokens sent to a re-created escrow ATA
  });

  it('canClose: terminal and escrow balance == 0', () => {
    const expired = inv({ status: InvoiceStatus.Expired });
    expect(canClose(expired, 0n)).toBe(true);
    expect(canClose(expired, 5n)).toBe(false);
    expect(canClose(paid({ claimed: true }), 0n)).toBe(true);
    expect(canClose(paid({ claimed: true, paidAmount: 150n }), 0n)).toBe(false); // excess outstanding
    expect(canClose(closed(), 0n)).toBe(false); // tombstone: never closed again
    expect(canClose(inv(), 0n)).toBe(false); // open
  });
});

// ---------------------------------------------------------------------------
// Flag truth table from STATE-MACHINE.md, row by row.
// columns: claimed | paid>due | refunded_excess | vault | claim | refund | recover | close
// recover/close marked "if vault>0"/"if vault==0" are evaluated at vault=5n and vault=0n.
// ---------------------------------------------------------------------------
interface Row {
  name: string;
  invoice: Invoice;
  expect: {
    claim: boolean;
    refund: boolean;
    recoverAt5: boolean;
    recoverAt0: boolean;
    closeAt5: boolean;
    closeAt0: boolean;
  };
}

const rows: Row[] = [
  {
    name: 'row1 false/no/0',
    invoice: paid({ claimed: false, paidAmount: 100n, refundedExcess: 0n }),
    expect: { claim: true, refund: false, recoverAt5: false, recoverAt0: false, closeAt5: false, closeAt0: false },
  },
  {
    name: 'row2 false/yes/0',
    invoice: paid({ claimed: false, paidAmount: 150n, refundedExcess: 0n }),
    expect: { claim: true, refund: true, recoverAt5: false, recoverAt0: false, closeAt5: false, closeAt0: false },
  },
  {
    name: 'row3 true/no/0',
    invoice: paid({ claimed: true, paidAmount: 100n, refundedExcess: 0n }),
    expect: { claim: false, refund: false, recoverAt5: true, recoverAt0: false, closeAt5: false, closeAt0: true },
  },
  {
    name: 'row4 true/yes/0',
    invoice: paid({ claimed: true, paidAmount: 150n, refundedExcess: 0n }),
    expect: { claim: false, refund: true, recoverAt5: false, recoverAt0: false, closeAt5: false, closeAt0: false },
  },
  {
    name: 'row5 true/yes/=excess',
    invoice: paid({ claimed: true, paidAmount: 150n, refundedExcess: 50n }),
    expect: { claim: false, refund: false, recoverAt5: true, recoverAt0: false, closeAt5: false, closeAt0: true },
  },
  {
    name: 'row6 expired',
    invoice: inv({ status: InvoiceStatus.Expired }),
    expect: { claim: false, refund: false, recoverAt5: true, recoverAt0: false, closeAt5: false, closeAt0: true },
  },
];

describe('flag truth table', () => {
  for (const row of rows) {
    it(`${row.name}: claim/refund/recover/close`, () => {
      expect(canClaim(row.invoice), 'claim').toBe(row.expect.claim);
      expect(canRefund(row.invoice), 'refund').toBe(row.expect.refund);
      expect(canRecover(row.invoice, 5n), 'recover@5').toBe(row.expect.recoverAt5);
      expect(canRecover(row.invoice, 0n), 'recover@0').toBe(row.expect.recoverAt0);
      expect(canClose(row.invoice, 5n), 'close@5').toBe(row.expect.closeAt5);
      expect(canClose(row.invoice, 0n), 'close@0').toBe(row.expect.closeAt0);
    });
  }
});

// ---------------------------------------------------------------------------
// Every rejected transition maps to expectedRejection(...) per PROGRAM-SPEC order.
// ---------------------------------------------------------------------------
describe('expectedRejection: rejected transitions', () => {
  const cases: { name: string; action: Parameters<typeof expectedRejection>[0]; invoice: Invoice; nowSec?: bigint; excess?: bigint; expectedAmountDue?: bigint; want: PaytruthErrorName | null }[] = [
    { name: 'pay when Paid', action: 'pay', invoice: paid(), want: 'DuplicatePayment' },
    { name: 'pay when Expired', action: 'pay', invoice: inv({ status: InvoiceStatus.Expired }), want: 'DuplicatePayment' },
    { name: 'pay when Closed beats a stale amount', action: 'pay', invoice: closed(), expectedAmountDue: 999n, want: 'DuplicatePayment' },
    { name: 'pay with a stale expected_amount_due', action: 'pay', invoice: inv(), expectedAmountDue: 999n, want: 'InvoiceMismatch' },
    { name: 'pay with the observed expected_amount_due', action: 'pay', invoice: inv(), expectedAmountDue: 100n, nowSec: NOW_BEFORE, want: null },
    { name: 'pay after expiry (Open)', action: 'pay', invoice: inv(), nowSec: NOW_AT, want: 'InvoiceExpired' },
    { name: 'pay on Open before expiry is allowed (precondition order ok)', action: 'pay', invoice: inv(), nowSec: NOW_BEFORE, want: null },
    { name: 'expire before expires_at', action: 'expire', invoice: inv(), nowSec: NOW_BEFORE, want: 'NotExpired' },
    { name: 'expire on Paid', action: 'expire', invoice: paid(), nowSec: NOW_AFTER, want: 'InvoiceNotOpen' },
    { name: 'expire already Expired', action: 'expire', invoice: inv({ status: InvoiceStatus.Expired }), nowSec: NOW_AFTER, want: 'InvoiceNotOpen' },
    { name: 'expire when Closed', action: 'expire', invoice: closed(), nowSec: NOW_AFTER, want: 'InvoiceNotOpen' },
    { name: 'claim on Open', action: 'claim', invoice: inv(), want: 'InvoiceNotPaid' },
    { name: 'claim on Expired', action: 'claim', invoice: inv({ status: InvoiceStatus.Expired }), want: 'InvoiceNotPaid' },
    { name: 'claim on Closed', action: 'claim', invoice: closed({ payer, paidAmount: 100n }), want: 'InvoiceNotPaid' },
    { name: 'claim twice', action: 'claim', invoice: paid({ claimed: true }), want: 'AlreadyClaimed' },
    { name: 'refund twice', action: 'refund', invoice: paid({ paidAmount: 150n, refundedExcess: 50n }), want: 'AlreadyRefunded' },
    { name: 'refund no excess', action: 'refund', invoice: paid({ paidAmount: 100n }), want: 'NothingToRefund' },
    { name: 'refund on Open', action: 'refund', invoice: inv(), want: 'InvoiceNotPaid' },
    { name: 'refund on Closed', action: 'refund', invoice: closed({ payer, paidAmount: 150n }), want: 'InvoiceNotPaid' },
    { name: 'close with non-empty vault', action: 'close', invoice: paid({ claimed: true }), excess: 5n, want: 'VaultNotEmpty' },
    { name: 'close on Open', action: 'close', invoice: inv(), excess: 0n, want: 'InvoiceNotTerminal' },
    { name: 'close on Closed tombstone', action: 'close', invoice: closed(), excess: 0n, want: 'InvoiceNotTerminal' },
    { name: 'close before claim (Paid unclaimed)', action: 'close', invoice: paid({ claimed: false }), excess: 0n, want: 'InvoiceNotTerminal' },
    { name: 'close with excess outstanding', action: 'close', invoice: paid({ claimed: true, paidAmount: 150n }), excess: 0n, want: 'ExcessOutstanding' },
    { name: 'recover Closed with re-created escrow funds', action: 'recover', invoice: closed(), excess: 5n, want: null },
    { name: 'recover Closed with empty vault', action: 'recover', invoice: closed(), excess: 0n, want: 'NothingToRecover' },
    { name: 'recover with empty vault', action: 'recover', invoice: inv({ status: InvoiceStatus.Expired }), excess: 0n, want: 'NothingToRecover' },
    { name: 'recover before terminal', action: 'recover', invoice: inv(), excess: 5n, want: 'InvoiceNotTerminal' },
    { name: 'recover with excess outstanding', action: 'recover', invoice: paid({ claimed: true, paidAmount: 150n }), excess: 5n, want: 'ExcessOutstanding' },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        expectedRejection(c.action, c.invoice, c.nowSec ?? NOW_BEFORE, c.excess ?? 5n, c.expectedAmountDue),
      ).toBe(c.want);
    });
  }

  it('allowed transitions return null', () => {
    expect(expectedRejection('claim', paid({ claimed: false }))).toBeNull();
    expect(expectedRejection('refund', paid({ paidAmount: 150n }))).toBeNull();
    expect(expectedRejection('expire', inv(), NOW_AT)).toBeNull();
    expect(expectedRejection('close', inv({ status: InvoiceStatus.Expired }), NOW_AFTER, 0n)).toBeNull();
    expect(expectedRejection('recover', inv({ status: InvoiceStatus.Expired }), NOW_AFTER, 5n)).toBeNull();
  });
});

describe('deriveInvoiceView', () => {
  it('not_found when invoice null', () => {
    const v = deriveInvoiceView(null, null, { commitment: 'confirmed', nowSec: NOW_BEFORE });
    expect(v.phase).toBe('not_found');
    expect(v.badge).toBe('NOT_FOUND');
    expect(v.actions.pay).toBe(false);
  });

  it('open invoice with UNPAID badge and pay action', () => {
    const v = deriveInvoiceView(inv(), 0n, { commitment: 'confirmed', nowSec: NOW_BEFORE });
    expect(v.phase).toBe('open');
    expect(v.badge).toBe('UNPAID');
    expect(v.actions.pay).toBe(true);
    expect(v.actions.expire).toBe(false);
    expect(v.confirming).toBe(false);
  });

  it('awaiting_expiry when Open but past expires_at', () => {
    const v = deriveInvoiceView(inv(), 0n, { commitment: 'confirmed', nowSec: NOW_AT });
    expect(v.phase).toBe('awaiting_expiry');
    expect(v.actions.pay).toBe(false);
    expect(v.actions.expire).toBe(true);
  });

  it('paid: PAID badge, confirming until finalized', () => {
    const v = deriveInvoiceView(paid(), 100n, { commitment: 'confirmed', nowSec: NOW_BEFORE });
    expect(v.phase).toBe('paid');
    expect(v.badge).toBe('PAID');
    expect(v.confirming).toBe(true);
    expect(v.actions.claim).toBe(true);
    expect(v.actions.refund).toBe(false);
  });

  it('claimed: CLAIMED badge, confirming at confirmed, actions close when vault empty', () => {
    const v = deriveInvoiceView(paid({ claimed: true }), 0n, { commitment: 'confirmed', nowSec: NOW_BEFORE });
    expect(v.badge).toBe('CLAIMED');
    expect(v.confirming).toBe(true);
    expect(v.actions.claim).toBe(false);
    expect(v.actions.close).toBe(true);
    const fin = deriveInvoiceView(paid({ claimed: true }), 0n, { commitment: 'finalized', nowSec: NOW_BEFORE });
    expect(fin.confirming).toBe(false);
  });

  it('expired: EXPIRED badge, recover when unattributed funds present', () => {
    const v = deriveInvoiceView(inv({ status: InvoiceStatus.Expired }), 50n, { commitment: 'confirmed', nowSec: NOW_AFTER });
    expect(v.phase).toBe('expired');
    expect(v.badge).toBe('EXPIRED');
    expect(v.actions.recover).toBe(true);
    expect(v.actions.close).toBe(false);
    expect(v.confirming).toBe(false);
  });

  it('closed: CLOSED badge, terminal tombstone; recover only with stray escrow funds', () => {
    const v = deriveInvoiceView(closed(), 7n, { commitment: 'finalized', nowSec: NOW_AFTER });
    expect(v.phase).toBe('closed');
    expect(v.badge).toBe('CLOSED');
    expect(v.confirming).toBe(false);
    expect(v.actions.pay).toBe(false);
    expect(v.actions.expire).toBe(false);
    expect(v.actions.claim).toBe(false);
    expect(v.actions.refund).toBe(false);
    expect(v.actions.close).toBe(false);
    expect(v.actions.recover).toBe(true);
    expect(v.unattributed).toBe(7n); // Closed expects no escrow holdings
    expect(deriveInvoiceView(closed(), 0n, { commitment: 'finalized', nowSec: NOW_AFTER }).actions.recover).toBe(false);
  });

  it('excess + refundPending reported', () => {
    const v = deriveInvoiceView(paid({ paidAmount: 150n }), 150n, { commitment: 'confirmed', nowSec: NOW_BEFORE });
    expect(v.excess).toBe(50n);
    expect(v.refundPending).toBe(true);
    expect(v.actions.refund).toBe(true);
  });

  it('unattributed = escrow balance - expected holdings', () => {
    // Open expects 0; 5 stray -> unattributed 5
    expect(deriveInvoiceView(inv(), 5n, { commitment: 'confirmed', nowSec: NOW_BEFORE }).unattributed).toBe(5n);
    // Paid exact expects 100; balance 105 -> unattributed 5
    expect(deriveInvoiceView(paid(), 105n, { commitment: 'confirmed', nowSec: NOW_BEFORE }).unattributed).toBe(5n);
    // Paid exact, balance exactly due -> 0
    expect(deriveInvoiceView(paid(), 100n, { commitment: 'confirmed', nowSec: NOW_BEFORE }).unattributed).toBe(0n);
    // Paid over, expected = due + excess = paid -> 0
    expect(
      deriveInvoiceView(paid({ paidAmount: 150n }), 150n, { commitment: 'confirmed', nowSec: NOW_BEFORE }).unattributed,
    ).toBe(0n);
    // Paid claimed, excess outstanding: expected = excess 50; balance 50 -> 0
    expect(
      deriveInvoiceView(paid({ claimed: true, paidAmount: 150n }), 50n, { commitment: 'confirmed', nowSec: NOW_BEFORE })
        .unattributed,
    ).toBe(0n);
    // Expired expects 0; stray 5 -> 5
    expect(
      deriveInvoiceView(inv({ status: InvoiceStatus.Expired }), 5n, { commitment: 'confirmed', nowSec: NOW_AFTER })
        .unattributed,
    ).toBe(5n);
  });

  it('Paid invoice past expiry stays Paid', () => {
    const v = deriveInvoiceView(paid(), 100n, { commitment: 'confirmed', nowSec: NOW_AFTER });
    expect(v.phase).toBe('paid');
  });
});
