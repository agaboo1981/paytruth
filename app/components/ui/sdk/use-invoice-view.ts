'use client';

import type { PublicKey } from '@solana/web3.js';

import { useInvoice, type InvoiceView } from '@/lib/paytruth/react';

import { sdk } from './client';

export type { InvoiceView };

/** Full-Stack useInvoice; `sdk` keeps NEXT_PUBLIC_PAYTRUTH_SDK=mock working. */
export function useInvoiceView(invoicePda: PublicKey | null): InvoiceView {
  return useInvoice(invoicePda, { client: sdk });
}
