/**
 * Integration point: replace this file's body with `export { ... } from '@/lib/paytruth'`
 * once Full-Stack lands the SDK. Never fake chain results here.
 *
 * Until then every method throws so the UI cannot mistake a fake result for a
 * confirmed on-chain one. Set NEXT_PUBLIC_PAYTRUTH_SDK=real to use this build.
 */
import type { PublicKey } from '@solana/web3.js';

import type { PaytruthSdk } from './types';

const NOT_WIRED =
  'Paytruth SDK not wired yet: Full-Stack SDK (lib/paytruth) is not available in this build.';

function notWired(): never {
  throw new Error(NOT_WIRED);
}

async function reject<T>(): Promise<T> {
  throw new Error(NOT_WIRED);
}

export const realSdk: PaytruthSdk = {
  getInvoicePda(_merchant: PublicKey, _invoiceId: bigint): never {
    return notWired();
  },
  getConfigPda(): never {
    return notWired();
  },
  getEscrowAta(_invoicePda: PublicKey, _mint: PublicKey): never {
    return notWired();
  },
  fetchConfig: () => reject(),
  fetchInvoice: () => reject(),
  fetchInvoiceByMerchantAndId: () => reject(),
  fetchEscrowBalance: () => reject(),
  initializeConfig: () => reject(),
  createInvoice: () => reject(),
  payInvoice: () => reject(),
  merchantClaim: () => reject(),
  refundOverpayment: () => reject(),
  expireInvoice: () => reject(),
  recoverUnattributed: () => reject(),
  closeInvoice: () => reject(),
  waitForInvoiceState: () => reject(),
  subscribeInvoice(): () => void {
    return notWired();
  },
};
