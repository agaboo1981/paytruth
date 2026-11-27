import type { PublicKey } from '@solana/web3.js';

import { getBoundClient, type PaytruthSdk, type WriteOptions } from '../../../lib/paytruth';
import { isMock } from './client';
import { mockSdk } from './mock-sdk';

export type StagedWriteResult = {
  signature: string;
  invoicePda?: PublicKey;
};

type CreateInvoiceArgs = Parameters<PaytruthSdk['createInvoice']>[0];
type PayInvoiceArgs = Parameters<PaytruthSdk['payInvoice']>[0];
type InvoicePdaArgs = Parameters<PaytruthSdk['merchantClaim']>[0];
type RecoverUnattributedArgs = Parameters<PaytruthSdk['recoverUnattributed']>[0];

function boundClient() {
  const client = getBoundClient();
  if (!client.wallet) throw new Error('Connect a wallet first.');
  return client;
}

export const stagedWrites = {
  async createInvoice(
    args: CreateInvoiceArgs,
    opts?: WriteOptions,
  ): Promise<{ signature: string; invoicePda: PublicKey }> {
    if (isMock) return mockSdk.createInvoice(args, opts);
    return boundClient().createInvoice(args, opts);
  },

  async payInvoice(args: PayInvoiceArgs, opts?: WriteOptions): Promise<StagedWriteResult> {
    if (isMock) return mockSdk.payInvoice(args, opts);
    return boundClient().payInvoice(args, opts);
  },

  async merchantClaim(args: InvoicePdaArgs, opts?: WriteOptions): Promise<StagedWriteResult> {
    if (isMock) return mockSdk.merchantClaim(args, opts);
    return boundClient().merchantClaim(args, opts);
  },

  async refundOverpayment(args: InvoicePdaArgs, opts?: WriteOptions): Promise<StagedWriteResult> {
    if (isMock) return mockSdk.refundOverpayment(args, opts);
    return boundClient().refundOverpayment(args, opts);
  },

  async expireInvoice(args: InvoicePdaArgs, opts?: WriteOptions): Promise<StagedWriteResult> {
    if (isMock) return mockSdk.expireInvoice(args, opts);
    return boundClient().expireInvoice(args, opts);
  },

  async recoverUnattributed(
    args: RecoverUnattributedArgs,
    opts?: WriteOptions,
  ): Promise<StagedWriteResult> {
    if (isMock) return mockSdk.recoverUnattributed(args, opts);
    return boundClient().recoverUnattributed(args, opts);
  },

  async closeInvoice(args: InvoicePdaArgs, opts?: WriteOptions): Promise<StagedWriteResult> {
    if (isMock) return mockSdk.closeInvoice(args, opts);
    return boundClient().closeInvoice(args, opts);
  },
};
