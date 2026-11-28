import { PublicKey, type Connection, type GetProgramAccountsFilter } from '@solana/web3.js';

import { decodeInvoice, INVOICE_ACCOUNT_SIZE, PAYTRUTH_IDL } from '../../../lib/paytruth';
import { encodeBase58 } from '../sdk/base58';
import { InvoiceStatus, type Invoice } from '../sdk/types';

/**
 * Invoice account layout (Anchor, IDL anchor-4252df8):
 *   0..8    discriminator
 *   8..40   merchant  (Pubkey)
 *   40..72  payer     (Pubkey, plain — PublicKey.default (all zeros) until paid; NOT Option<Pubkey>)
 *   72..104 mint
 *   ...     invoice_id, amount_due, paid_amount, refunded_excess, created_at, expires_at (u64/i64)
 *   152     status u8, 153 claimed bool, 154 bump u8, 155..219 memo [u8;64]
 * Total 219 bytes (INVOICE_ACCOUNT_SIZE). Offsets are verified against the IDL in query.test.ts.
 */
export const INVOICE_DISCRIMINATOR = Uint8Array.from(
  PAYTRUTH_IDL.accounts.find((a) => a.name === 'Invoice')!.discriminator,
);
export const MERCHANT_OFFSET = 8;
export const PAYER_OFFSET = 40;

export type InvoiceRole = 'merchant' | 'payer';

export type ListedInvoice = { pda: PublicKey; invoice: Invoice };

export function invoiceFilters(role: InvoiceRole, wallet: PublicKey): GetProgramAccountsFilter[] {
  return [
    { dataSize: INVOICE_ACCOUNT_SIZE },
    { memcmp: { offset: 0, bytes: encodeBase58(INVOICE_DISCRIMINATOR) } },
    { memcmp: { offset: role === 'merchant' ? MERCHANT_OFFSET : PAYER_OFFSET, bytes: wallet.toBase58() } },
  ];
}

/** Read-only: every Invoice account where `wallet` is the merchant (or the recorded payer). */
export async function fetchInvoicesFor(
  connection: Connection,
  programId: PublicKey,
  role: InvoiceRole,
  wallet: PublicKey,
): Promise<ListedInvoice[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: 'confirmed',
    filters: invoiceFilters(role, wallet),
  });
  const out: ListedInvoice[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      out.push({ pda: pubkey, invoice: decodeInvoice(account.data) });
    } catch {
      // Skip anything that doesn't decode; never guess at its state.
    }
  }
  return out;
}

export type InvoiceGroup = 'needs-action' | 'open' | 'done';

export type InvoiceRowStatus = {
  group: InvoiceGroup;
  label: string;
  hint: string;
  tone: 'default' | 'success' | 'warning' | 'danger' | 'pending';
  canClaim: boolean;
};

/** Plain-language status for one invoice, seen from the merchant's side. */
export function classifyInvoice(invoice: Invoice, nowSec: bigint, role: InvoiceRole = 'merchant'): InvoiceRowStatus {
  const excess = invoice.paidAmount > invoice.amountDue ? invoice.paidAmount - invoice.amountDue : 0n;
  const refundDue = invoice.status === InvoiceStatus.Paid && excess > 0n && invoice.refundedExcess === 0n;
  const canClaim = invoice.status === InvoiceStatus.Paid && !invoice.claimed;
  const merchant = role === 'merchant';

  if (invoice.status === InvoiceStatus.Closed) {
    return { group: 'done', label: 'Closed', hint: 'Settled and closed.', tone: 'default', canClaim: false };
  }
  if (invoice.status === InvoiceStatus.Expired) {
    return { group: 'done', label: 'Expired', hint: 'Expired without payment.', tone: 'default', canClaim: false };
  }
  if (invoice.status === InvoiceStatus.Paid) {
    if (canClaim && refundDue) {
      return {
        group: merchant ? 'needs-action' : 'open',
        label: 'Paid — claim and refund extra',
        hint: merchant ? 'The customer paid too much. Claim your payment and refund the extra.' : 'Paid. The merchant still has to refund your extra.',
        tone: 'warning',
        canClaim,
      };
    }
    if (canClaim) {
      return {
        group: merchant ? 'needs-action' : 'done',
        label: merchant ? 'Paid — ready to claim' : 'Paid',
        hint: merchant ? 'The money is in escrow. Claim it to move it to your wallet.' : 'Your payment is in escrow.',
        tone: merchant ? 'warning' : 'success',
        canClaim,
      };
    }
    if (refundDue) {
      return {
        group: merchant ? 'needs-action' : 'open',
        label: 'Claimed — extra not refunded',
        hint: merchant ? 'Refund the overpayment to the customer.' : 'The merchant still has to refund your extra.',
        tone: 'warning',
        canClaim: false,
      };
    }
    return { group: 'done', label: 'Claimed', hint: 'Paid and claimed.', tone: 'success', canClaim: false };
  }
  // Open
  if (nowSec >= invoice.expiresAt) {
    return {
      group: merchant ? 'needs-action' : 'done',
      label: 'Past expiry — still open',
      hint: 'Mark it expired so it can no longer be paid.',
      tone: 'danger',
      canClaim: false,
    };
  }
  return { group: 'open', label: 'Waiting for payment', hint: 'Not paid yet.', tone: 'pending', canClaim: false };
}

export const GROUP_ORDER: InvoiceGroup[] = ['needs-action', 'open', 'done'];

export function groupInvoices(
  rows: ListedInvoice[],
  nowSec: bigint,
  role: InvoiceRole = 'merchant',
): Record<InvoiceGroup, (ListedInvoice & { status: InvoiceRowStatus })[]> {
  const groups: Record<InvoiceGroup, (ListedInvoice & { status: InvoiceRowStatus })[]> = {
    'needs-action': [],
    open: [],
    done: [],
  };
  for (const row of rows) {
    const status = classifyInvoice(row.invoice, nowSec, role);
    groups[status.group].push({ ...row, status });
  }
  for (const g of GROUP_ORDER) {
    groups[g].sort((a, b) => (a.invoice.createdAt === b.invoice.createdAt ? 0 : a.invoice.createdAt > b.invoice.createdAt ? -1 : 1));
  }
  return groups;
}

export type StatusFilter =
  | 'all'
  | 'needs-action'
  | 'open'
  | 'paid'
  | 'claimed'
  | 'overpaid'
  | 'expired'
  | 'closed';

/**
 * Status filter tabs, each defined only from on-chain Invoice fields. An invoice can match several.
 *  all          every invoice
 *  needs-action classifyInvoice(...).group === 'needs-action' (role-aware: merchant has to claim / refund / expire)
 *  open         status == Open && now <  expires_at                 (payable)
 *  paid         status == Paid && !claimed                         (money in escrow, not yet claimed)
 *  claimed      claimed == true                                    (any status, incl. Closed tombstones)
 *  overpaid     paid_amount > amount_due                           (refunded or not; refunded_excess > 0 means refunded)
 *  expired      status == Expired || (status == Open && now >= expires_at)
 *  closed       status == Closed
 * There is no cancel instruction in the program, so there is no Cancelled state.
 */
export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs-action', label: 'Needs action' },
  { id: 'open', label: 'Open' },
  { id: 'paid', label: 'Paid' },
  { id: 'claimed', label: 'Claimed' },
  { id: 'overpaid', label: 'Overpaid / Refunded' },
  { id: 'expired', label: 'Expired' },
  { id: 'closed', label: 'Closed' },
];

export function matchesFilter(invoice: Invoice, filter: StatusFilter, nowSec: bigint, role: InvoiceRole = 'merchant'): boolean {
  const pastExpiry = nowSec >= invoice.expiresAt;
  switch (filter) {
    case 'all':
      return true;
    case 'needs-action':
      return classifyInvoice(invoice, nowSec, role).group === 'needs-action';
    case 'open':
      return invoice.status === InvoiceStatus.Open && !pastExpiry;
    case 'paid':
      return invoice.status === InvoiceStatus.Paid && !invoice.claimed;
    case 'claimed':
      return invoice.claimed;
    case 'overpaid':
      return invoice.paidAmount > invoice.amountDue;
    case 'expired':
      return invoice.status === InvoiceStatus.Expired || (invoice.status === InvoiceStatus.Open && pastExpiry);
    case 'closed':
      return invoice.status === InvoiceStatus.Closed;
  }
}

export function filterCounts(rows: ListedInvoice[], nowSec: bigint, role: InvoiceRole = 'merchant'): Record<StatusFilter, number> {
  const counts = Object.fromEntries(STATUS_FILTERS.map((f) => [f.id, 0])) as Record<StatusFilter, number>;
  for (const { invoice } of rows) for (const f of STATUS_FILTERS) if (matchesFilter(invoice, f.id, nowSec, role)) counts[f.id] += 1;
  return counts;
}
