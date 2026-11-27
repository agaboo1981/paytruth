import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';

import { decodeMemo, derivedView, formatUsdc, parseUsdc } from './format';
import { InvoiceStatus, type Invoice } from './types';

const U = 1_000_000n;

describe('formatUsdc', () => {
  it('formats whole amounts with two decimals', () => {
    expect(formatUsdc(0n)).toBe('0.00 USDC');
    expect(formatUsdc(25n * U)).toBe('25.00 USDC');
    expect(formatUsdc(1000n * U)).toBe('1,000.00 USDC');
  });

  it('trims to a minimum of two decimals', () => {
    expect(formatUsdc(45_500_000n)).toBe('45.50 USDC');
    expect(formatUsdc(1_234_560n)).toBe('1.23456 USDC');
  });

  it('keeps up to six decimals, trimming trailing zeros', () => {
    expect(formatUsdc(1_000_000n + 100_000n)).toBe('1.10 USDC');
    expect(formatUsdc(999_999n)).toBe('0.999999 USDC');
    expect(formatUsdc(1_200_000n)).toBe('1.20 USDC');
  });

  it('formats large values with grouping', () => {
    expect(formatUsdc(1_234_567_890_000n)).toBe('1,234,567.89 USDC');
  });
});

describe('parseUsdc', () => {
  it('parses whole and fractional amounts', () => {
    expect(parseUsdc('25')).toBe(25n * U);
    expect(parseUsdc('45.50')).toBe(45_500_000n);
    expect(parseUsdc('0.000001')).toBe(1n);
    expect(parseUsdc(' 1.5 ')).toBe(1_500_000n);
  });

  it('rejects more than six decimals', () => {
    expect(parseUsdc('1.1234567')).toBeNull();
  });

  it('rejects negatives, garbage and empty input', () => {
    expect(parseUsdc('-1')).toBeNull();
    expect(parseUsdc('abc')).toBeNull();
    expect(parseUsdc('')).toBeNull();
    expect(parseUsdc('1.2.3')).toBeNull();
    expect(parseUsdc('1e6')).toBeNull();
    expect(parseUsdc('.')).toBeNull();
  });

  it('round-trips through formatUsdc', () => {
    for (const value of ['0.000001', '12.34', '1000', '7.000500']) {
      const parsed = parseUsdc(value);
      expect(parsed).not.toBeNull();
      const reformatted = formatUsdc(parsed as bigint).replace(/,/g, '').replace(' USDC', '');
      expect(parseUsdc(reformatted)).toBe(parsed);
    }
  });
});

describe('decodeMemo', () => {
  it('trims zero padding', () => {
    const bytes = new Uint8Array(64);
    bytes.set(new TextEncoder().encode('Logo design'));
    expect(decodeMemo(bytes)).toBe('Logo design');
  });

  it('returns empty for an all-zero memo', () => {
    expect(decodeMemo(new Uint8Array(64))).toBe('');
  });
});

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return {
    merchant: new PublicKey('7rQNw7k4dY6mJf2sT9zXbC3vLp8HnKqE5uWaYdR6gXcS'),
    payer: PublicKey.default,
    mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
    invoiceId: 1n,
    amountDue: 25n * U,
    paidAmount: 0n,
    refundedExcess: 0n,
    createdAt: 0n,
    expiresAt: 1000n,
    status: InvoiceStatus.Open,
    claimed: false,
    bump: 255,
    memo: new Uint8Array(64),
    ...overrides,
  };
}

const NOW = 500;

// Flag truth table from STATE-MACHINE.md, mapped to the derived flags.
describe('derivedView flag truth table', () => {
  it('open, unpaid: can pay + expire after expiry only', () => {
    const open = derivedView(makeInvoice({}), NOW, 0n);
    expect(open.kind).toBe('open');
    expect(open.canPay).toBe(true);
    expect(open.canClaim).toBe(false);
    expect(open.canRefund).toBe(false);
    expect(open.canExpire).toBe(false);
    expect(open.canRecover).toBe(false);
    expect(open.canClose).toBe(false);
  });

  it('open, past expiry: expiring, cannot pay, can expire', () => {
    const view = derivedView(makeInvoice({ expiresAt: 400n }), NOW, 0n);
    expect(view.kind).toBe('expired');
    expect(view.canPay).toBe(false);
    expect(view.canExpire).toBe(true);
  });

  it('paid exact, unclaimed: claim only', () => {
    const view = derivedView(
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 25n * U }),
      NOW,
      25n * U,
    );
    expect(view.kind).toBe('paid');
    expect(view.excess).toBe(0n);
    expect(view.canClaim).toBe(true);
    expect(view.canRefund).toBe(false);
    expect(view.canRecover).toBe(false);
    expect(view.canClose).toBe(false);
  });

  it('paid over, unclaimed: claim and refund, no recover/close', () => {
    const view = derivedView(
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 30n * U }),
      NOW,
      30n * U,
    );
    expect(view.kind).toBe('overpaid-refund-due');
    expect(view.excess).toBe(5n * U);
    expect(view.canClaim).toBe(true);
    expect(view.canRefund).toBe(true);
    expect(view.canRecover).toBe(false);
    expect(view.canClose).toBe(false);
  });

  it('paid exact, claimed, vault empty: close only', () => {
    const view = derivedView(
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 25n * U, claimed: true }),
      NOW,
      0n,
    );
    expect(view.kind).toBe('claimed');
    expect(view.canClaim).toBe(false);
    expect(view.canRefund).toBe(false);
    expect(view.canRecover).toBe(false);
    expect(view.canClose).toBe(true);
  });

  it('paid exact, claimed, vault non-empty: recover only', () => {
    const view = derivedView(
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 25n * U, claimed: true }),
      NOW,
      3n * U,
    );
    expect(view.canRecover).toBe(true);
    expect(view.canClose).toBe(false);
  });

  it('paid over, claimed, unrefunded: refund only, no recover/close', () => {
    const view = derivedView(
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 30n * U, claimed: true }),
      NOW,
      30n * U,
    );
    expect(view.canRefund).toBe(true);
    expect(view.canRecover).toBe(false);
    expect(view.canClose).toBe(false);
  });

  it('paid over, refunded, not claimed: refunded (ready to claim)', () => {
    const view = derivedView(
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 30n * U, claimed: false, refundedExcess: 5n * U }),
      NOW,
      25n * U,
    );
    expect(view.kind).toBe('refunded');
    expect(view.canClaim).toBe(true);
    expect(view.canRefund).toBe(false);
  });

  it('paid over, claimed, refunded, vault empty: close', () => {
    const view = derivedView(
      makeInvoice({
        status: InvoiceStatus.Paid,
        paidAmount: 30n * U,
        claimed: true,
        refundedExcess: 5n * U,
      }),
      NOW,
      0n,
    );
    expect(view.kind).toBe('claimed');
    expect(view.canRefund).toBe(false);
    expect(view.canRecover).toBe(false);
    expect(view.canClose).toBe(true);
  });

  it('paid over, claimed, refunded, vault non-empty: recover', () => {
    const view = derivedView(
      makeInvoice({
        status: InvoiceStatus.Paid,
        paidAmount: 30n * U,
        claimed: true,
        refundedExcess: 5n * U,
      }),
      NOW,
      1n * U,
    );
    expect(view.canRecover).toBe(true);
    expect(view.canClose).toBe(false);
  });

  it('expired, vault empty: close', () => {
    const view = derivedView(makeInvoice({ status: InvoiceStatus.Expired }), NOW, 0n);
    expect(view.kind).toBe('expired');
    expect(view.canPay).toBe(false);
    expect(view.canClaim).toBe(false);
    expect(view.canExpire).toBe(false);
    expect(view.canRecover).toBe(false);
    expect(view.canClose).toBe(true);
  });

  it('expired, vault non-empty: recover', () => {
    const view = derivedView(makeInvoice({ status: InvoiceStatus.Expired }), NOW, 2n * U);
    expect(view.canRecover).toBe(true);
    expect(view.canClose).toBe(false);
  });

  it('closed exposes the closed copy and disables every action', () => {
    const view = derivedView(
      makeInvoice({ status: InvoiceStatus.Closed, paidAmount: 25n * U, claimed: true }),
      NOW,
      0n,
    );
    expect(view.kind).toBe('closed');
    expect(view.headline).toBe('Closed');
    expect(view.explanation).toBe(
      'The merchant closed this invoice after it was settled. Nothing more can happen to it.',
    );
    expect(view.canPay).toBe(false);
    expect(view.canClaim).toBe(false);
    expect(view.canRefund).toBe(false);
    expect(view.canExpire).toBe(false);
    expect(view.canRecover).toBe(false);
    expect(view.canClose).toBe(false);
  });

  it('every kind exposes headline and explanation', () => {
    const samples = [
      makeInvoice({}),
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 25n * U }),
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 30n * U }),
      makeInvoice({ status: InvoiceStatus.Paid, paidAmount: 30n * U, claimed: true, refundedExcess: 5n * U }),
      makeInvoice({ status: InvoiceStatus.Expired }),
      makeInvoice({ status: InvoiceStatus.Closed, paidAmount: 25n * U, claimed: true }),
    ];
    for (const invoice of samples) {
      const view = derivedView(invoice, NOW, 0n);
      expect(view.headline.length).toBeGreaterThan(0);
      expect(view.explanation.length).toBeGreaterThan(0);
    }
  });
});
