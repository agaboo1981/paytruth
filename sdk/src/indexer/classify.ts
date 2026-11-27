import type { Commitment, Invoice } from '../types';
import { InvoiceStatus } from '../types';
import type { ParsedPaytruthTx } from './parseTransaction';

export type PaymentClass = 'pending' | 'paid' | 'overpaid' | 'double-pay' | 'failed' | 'not-a-payment';

function isPay(parsed: ParsedPaytruthTx): boolean {
  return parsed.instructions.some((ix) => ix.name === 'pay_invoice');
}

function payAmount(parsed: ParsedPaytruthTx): bigint | null {
  const ix = parsed.instructions.find((i) => i.name === 'pay_invoice');
  if (!ix) return null;
  const raw = (ix.args as { amount?: unknown }).amount;
  if (raw == null) return null;
  try {
    return BigInt(raw.toString());
  } catch {
    return null;
  }
}

export interface ClassifyContext {
  priorSuccessfulPay?: boolean;
}

/**
 * Classify a single parsed transaction as a payment attempt for an invoice.
 * This is purely observational; it never changes invoice status.
 */
export function classifyPaymentAttempt(
  parsed: ParsedPaytruthTx | null,
  invoice: Invoice,
  ctx: ClassifyContext = {},
): PaymentClass {
  if (!parsed) return 'pending';
  if (!isPay(parsed)) return 'not-a-payment';

  if (parsed.ok) {
    const amount = payAmount(parsed);
    if (ctx.priorSuccessfulPay) return 'double-pay';
    if (amount === null) return 'paid';
    if (amount > invoice.amountDue) return 'overpaid';
    if (amount === invoice.amountDue) return 'paid';
    // ok but amount < due should not happen on-chain (Underpayment), treat as paid observation.
    return 'paid';
  }

  // Failed pay instruction.
  if (parsed.error?.name === 'DuplicatePayment') return 'double-pay';
  return 'failed';
}

export interface InvoicePaymentAttempt {
  tx: ParsedPaytruthTx | null;
  cls: PaymentClass;
}

export type ChainStatus = 'unpaid' | 'paid' | 'overpaid' | 'expired' | 'closed' | 'not_found';

export interface InvoicePaymentSummary {
  /** Derived ONLY from the on-chain Invoice account. */
  chainStatus: ChainStatus;
  observed: Record<PaymentClass, number>;
  discrepancy?: string;
}

function emptyObserved(): Record<PaymentClass, number> {
  return {
    pending: 0,
    paid: 0,
    overpaid: 0,
    'double-pay': 0,
    failed: 0,
    'not-a-payment': 0,
  };
}

/**
 * Summarise observed payment attempts against the on-chain account.
 * RULE: chainStatus comes ONLY from invoiceAccount. If attempts show a
 * successful pay but the account at this commitment is not Paid, chainStatus
 * stays "unpaid" and a discrepancy is reported.
 */
export function summarizeInvoicePayments(
  attempts: InvoicePaymentAttempt[],
  invoiceAccount: Invoice | null,
  commitment: Commitment,
): InvoicePaymentSummary {
  const observed = emptyObserved();
  for (const a of attempts) observed[a.cls]++;

  if (!invoiceAccount) {
    return { chainStatus: 'not_found', observed };
  }

  let chainStatus: ChainStatus;
  switch (invoiceAccount.status) {
    case InvoiceStatus.Paid:
      chainStatus = invoiceAccount.paidAmount > invoiceAccount.amountDue ? 'overpaid' : 'paid';
      break;
    case InvoiceStatus.Expired:
      chainStatus = 'expired';
      break;
    case InvoiceStatus.Closed:
      chainStatus = 'closed';
      break;
    default:
      chainStatus = 'unpaid';
  }

  const sawSuccessfulPay = observed.paid > 0 || observed.overpaid > 0;
  if (sawSuccessfulPay && chainStatus === 'unpaid') {
    return {
      chainStatus: 'unpaid',
      observed,
      discrepancy: `pay tx observed but account not yet Paid at ${commitment}`,
    };
  }

  return { chainStatus, observed };
}
