// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
import { PublicKey } from '@solana/web3.js';
import type { Commitment, Invoice } from './types';
import { InvoiceStatus } from './types';
import type { PaytruthErrorName } from './errors';

export type PaytruthAction = 'pay' | 'claim' | 'refund' | 'expire' | 'recover' | 'close';

/** paid_amount - amount_due, floored at 0. */
export function excessOf(inv: Invoice): bigint {
  return inv.paidAmount > inv.amountDue ? inv.paidAmount - inv.amountDue : 0n;
}

/** True when there is no excess, or the recorded excess has been fully refunded. */
export function isExcessCleared(inv: Invoice): boolean {
  const excess = excessOf(inv);
  if (excess === 0n) return true;
  return inv.refundedExcess === excess;
}

/** Closed, Expired, OR (Paid && claimed && excess cleared). */
export function isTerminal(inv: Invoice): boolean {
  if (inv.status === InvoiceStatus.Closed) return true;
  if (inv.status === InvoiceStatus.Expired) return true;
  if (inv.status === InvoiceStatus.Paid) return inv.claimed && isExcessCleared(inv);
  return false;
}

export function canPay(inv: Invoice, nowSec: bigint): boolean {
  return inv.status === InvoiceStatus.Open && nowSec < inv.expiresAt;
}

export function canExpire(inv: Invoice, nowSec: bigint): boolean {
  return inv.status === InvoiceStatus.Open && nowSec >= inv.expiresAt;
}

export function canClaim(inv: Invoice): boolean {
  return inv.status === InvoiceStatus.Paid && !inv.claimed;
}

export function canRefund(inv: Invoice): boolean {
  return (
    inv.status === InvoiceStatus.Paid &&
    inv.paidAmount > inv.amountDue &&
    inv.refundedExcess === 0n &&
    !inv.payer.equals(PublicKey.default)
  );
}

export function canRecover(inv: Invoice, escrowBalance: bigint): boolean {
  return isTerminal(inv) && escrowBalance > 0n;
}

export function canClose(inv: Invoice, escrowBalance: bigint): boolean {
  if (inv.status === InvoiceStatus.Closed) return false;
  return isTerminal(inv) && escrowBalance === 0n;
}

/**
 * The error the program would raise for an attempted action, in the real
 * program's precondition order, or null if the action is allowed. Used to map
 * rejected transitions to their expected error names.
 */
export function expectedRejection(
  action: PaytruthAction,
  inv: Invoice,
  nowSec: bigint = 0n,
  escrowBalance: bigint = 0n,
  expectedAmountDue?: bigint,
): PaytruthErrorName | null {
  switch (action) {
    case 'pay': {
      if (inv.status !== InvoiceStatus.Open) return 'DuplicatePayment';
      if (expectedAmountDue !== undefined && expectedAmountDue !== inv.amountDue) return 'InvoiceMismatch';
      if (nowSec >= inv.expiresAt) return 'InvoiceExpired';
      // amount checks (amount > 0, amount >= amountDue) are caller-amount dependent;
      // those are validated by the caller, not by invoice state.
      return null;
    }
    case 'expire': {
      if (inv.status !== InvoiceStatus.Open) return 'InvoiceNotOpen';
      if (nowSec < inv.expiresAt) return 'NotExpired';
      return null;
    }
    case 'claim': {
      if (inv.status !== InvoiceStatus.Paid) return 'InvoiceNotPaid';
      if (inv.claimed) return 'AlreadyClaimed';
      return null;
    }
    case 'refund': {
      if (inv.status !== InvoiceStatus.Paid) return 'InvoiceNotPaid';
      if (inv.payer.equals(PublicKey.default)) return 'PayerNotRecorded';
      if (inv.paidAmount <= inv.amountDue) return 'NothingToRefund';
      if (inv.refundedExcess !== 0n) return 'AlreadyRefunded';
      return null;
    }
    case 'recover': {
      // terminal predicate with granular errors
      if (!isTerminal(inv)) {
        if (inv.status === InvoiceStatus.Paid && inv.claimed && !isExcessCleared(inv)) {
          return 'ExcessOutstanding';
        }
        return 'InvoiceNotTerminal';
      }
      if (!isExcessCleared(inv)) return 'ExcessOutstanding';
      if (escrowBalance <= 0n) return 'NothingToRecover';
      return null;
    }
    case 'close': {
      if (inv.status === InvoiceStatus.Closed) return 'InvoiceNotTerminal';
      if (!isTerminal(inv)) {
        if (inv.status === InvoiceStatus.Paid && inv.claimed && !isExcessCleared(inv)) {
          return 'ExcessOutstanding';
        }
        return 'InvoiceNotTerminal';
      }
      if (!isExcessCleared(inv)) return 'ExcessOutstanding';
      if (escrowBalance !== 0n) return 'VaultNotEmpty';
      return null;
    }
    default:
      return null;
  }
}

export type InvoicePhase = 'not_found' | 'open' | 'awaiting_expiry' | 'paid' | 'expired' | 'closed';
export type InvoiceBadge = 'UNPAID' | 'PAID' | 'CLAIMED' | 'EXPIRED' | 'CLOSED' | 'NOT_FOUND';

export interface InvoiceActions {
  pay: boolean;
  claim: boolean;
  refund: boolean;
  expire: boolean;
  recover: boolean;
  close: boolean;
}

export interface InvoiceView {
  phase: InvoicePhase;
  claimed: boolean;
  excess: bigint;
  refundPending: boolean;
  badge: InvoiceBadge;
  confirming: boolean;
  actions: InvoiceActions;
  unattributed: bigint;
}

/**
 * Expected escrow holdings for an invoice, used to compute unattributed funds.
 * Open: 0; Paid: (claimed ? 0 : amount_due) + (excess - refunded_excess);
 * Expired and Closed: 0.
 */
function expectedEscrowHoldings(inv: Invoice): bigint {
  if (inv.status === InvoiceStatus.Paid) {
    const claimable = inv.claimed ? 0n : inv.amountDue;
    const outstandingExcess = excessOf(inv) - inv.refundedExcess;
    return claimable + (outstandingExcess > 0n ? outstandingExcess : 0n);
  }
  return 0n;
}

export interface DeriveInvoiceViewOpts {
  commitment: Commitment;
  nowSec: bigint;
}

export function deriveInvoiceView(
  invoice: Invoice | null,
  escrowBalance: bigint | null,
  opts: DeriveInvoiceViewOpts,
): InvoiceView {
  const { commitment, nowSec } = opts;
  if (!invoice) {
    return {
      phase: 'not_found',
      claimed: false,
      excess: 0n,
      refundPending: false,
      badge: 'NOT_FOUND',
      confirming: false,
      actions: { pay: false, claim: false, refund: false, expire: false, recover: false, close: false },
      unattributed: 0n,
    };
  }

  const balance = escrowBalance ?? 0n;
  const excess = excessOf(invoice);
  const refundPending = invoice.status === InvoiceStatus.Paid && excess > 0n && invoice.refundedExcess === 0n;

  let phase: InvoicePhase;
  let badge: InvoiceBadge;
  if (invoice.status === InvoiceStatus.Closed) {
    phase = 'closed';
    badge = 'CLOSED';
  } else if (invoice.status === InvoiceStatus.Paid) {
    phase = 'paid';
    badge = invoice.claimed ? 'CLAIMED' : 'PAID';
  } else if (invoice.status === InvoiceStatus.Expired) {
    phase = 'expired';
    badge = 'EXPIRED';
  } else if (nowSec >= invoice.expiresAt) {
    phase = 'awaiting_expiry';
    badge = 'UNPAID';
  } else {
    phase = 'open';
    badge = 'UNPAID';
  }

  const confirming = commitment !== 'finalized' && (phase === 'paid' || badge === 'CLAIMED');

  const actions: InvoiceActions = {
    pay: canPay(invoice, nowSec),
    claim: canClaim(invoice),
    refund: canRefund(invoice),
    expire: canExpire(invoice, nowSec),
    recover: canRecover(invoice, balance),
    close: canClose(invoice, balance),
  };

  const unattributed = balance - expectedEscrowHoldings(invoice);

  return {
    phase,
    claimed: invoice.claimed,
    excess,
    refundPending,
    badge,
    confirming,
    actions,
    unattributed,
  };
}
