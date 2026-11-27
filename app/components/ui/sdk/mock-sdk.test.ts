import { PublicKey } from '@solana/web3.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { fixtureSpecs, MOCK_WALLET } from './fixtures';
import { FAIL_KEY, STORAGE_KEY, type StorageLike } from './mock-config';
import { MockPaytruthSdk, PaytruthProgramError } from './mock-sdk';
import { InvoiceStatus } from './types';

function createStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const U = 1_000_000n;
const OPEN = fixtureSpecs.open.pda;
const EXPIRING = fixtureSpecs.expiring.pda;

async function expectProgramError(promise: Promise<unknown>, name: string, hex: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PaytruthProgramError);
  expect((caught as Error).message).toContain(`Error Code: ${name}`);
  expect((caught as Error).message).toContain(`custom program error: ${hex}`);
}

describe('MockPaytruthSdk', () => {
  let storage: StorageLike;
  let sdk: MockPaytruthSdk;

  beforeEach(() => {
    storage = createStorage();
    sdk = new MockPaytruthSdk({ storage });
  });

  it('seeds the fixtures on first load', () => {
    const raw = storage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(Object.keys(parsed.invoices)).toContain(OPEN);
  });

  it('create -> pay exact -> claim', async () => {
    const expires = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const { invoicePda } = await sdk.createInvoice({
      invoiceId: 77n,
      amountDue: 10n * U,
      expiresAt: expires,
      memo: 'Test invoice',
    });

    const created = await sdk.fetchInvoice(invoicePda);
    expect(created.status).toBe(InvoiceStatus.Open);
    expect(created.amountDue).toBe(10n * U);

    await sdk.payInvoice({ invoicePda, amount: 10n * U });
    const paid = await sdk.fetchInvoice(invoicePda);
    expect(paid.status).toBe(InvoiceStatus.Paid);
    expect(await sdk.fetchEscrowBalance(invoicePda)).toBe(10n * U);

    await sdk.merchantClaim({ invoicePda });
    const claimed = await sdk.fetchInvoice(invoicePda);
    expect(claimed.claimed).toBe(true);
    expect(await sdk.fetchEscrowBalance(invoicePda)).toBe(0n);
  });

  it('rejects a duplicate payment with DuplicatePayment (6001)', async () => {
    const pda = new PublicKey(OPEN);
    await sdk.payInvoice({ invoicePda: pda, amount: 25n * U });
    await expectProgramError(sdk.payInvoice({ invoicePda: pda, amount: 25n * U }), 'DuplicatePayment', '0x1771');
  });

  it('rejects an underpayment with Underpayment (6000)', async () => {
    const pda = new PublicKey(OPEN);
    await expectProgramError(sdk.payInvoice({ invoicePda: pda, amount: 1n * U }), 'Underpayment', '0x1770');
  });

  it('overpay then refund returns the excess', async () => {
    const pda = new PublicKey(OPEN);
    await sdk.payInvoice({ invoicePda: pda, amount: 30n * U });
    let invoice = await sdk.fetchInvoice(pda);
    expect(invoice.paidAmount).toBe(30n * U);
    expect(await sdk.fetchEscrowBalance(pda)).toBe(30n * U);

    await sdk.refundOverpayment({ invoicePda: pda });
    invoice = await sdk.fetchInvoice(pda);
    expect(invoice.refundedExcess).toBe(5n * U);
    expect(await sdk.fetchEscrowBalance(pda)).toBe(25n * U);
  });

  it('paying an open invoice after expiry is rejected with InvoiceExpired (6003)', async () => {
    const pda = new PublicKey(EXPIRING);
    await expectProgramError(sdk.payInvoice({ invoicePda: pda, amount: 9_500_000n }), 'InvoiceExpired', '0x1773');
  });

  it('expire then pay is rejected as DuplicatePayment', async () => {
    const pda = new PublicKey(EXPIRING);
    await sdk.expireInvoice({ invoicePda: pda });
    const expired = await sdk.fetchInvoice(pda);
    expect(expired.status).toBe(InvoiceStatus.Expired);
    await expectProgramError(
      sdk.payInvoice({ invoicePda: pda, amount: 9_500_000n }),
      'DuplicatePayment',
      '0x1771',
    );
  });

  it('close is blocked while the excess is outstanding (ExcessOutstanding 6018)', async () => {
    const pda = new PublicKey(OPEN);
    await sdk.payInvoice({ invoicePda: pda, amount: 30n * U });
    await sdk.merchantClaim({ invoicePda: pda });
    await expectProgramError(sdk.closeInvoice({ invoicePda: pda }), 'ExcessOutstanding', '0x1782');
  });

  it('close is blocked when the vault holds stray funds (VaultNotEmpty 6016)', async () => {
    const pda = new PublicKey(fixtureSpecs.expired.pda);
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) as string);
    raw.invoices[pda.toBase58()].vault = U.toString();
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await expectProgramError(sdk.closeInvoice({ invoicePda: pda }), 'VaultNotEmpty', '0x1780');
  });

  it('close succeeds once the vault is empty', async () => {
    const pda = new PublicKey(OPEN);
    await sdk.payInvoice({ invoicePda: pda, amount: 25n * U });
    await sdk.merchantClaim({ invoicePda: pda });
    await sdk.closeInvoice({ invoicePda: pda });
    await expect(sdk.fetchInvoice(pda)).rejects.toThrow();
  });

  it('honours the fail mode and clears it after use', async () => {
    storage.setItem(FAIL_KEY, 'reject');
    const pda = new PublicKey(OPEN);
    await expect(sdk.payInvoice({ invoicePda: pda, amount: 25n * U })).rejects.toThrow(/User rejected/);
    expect(storage.getItem(FAIL_KEY)).toBeNull();
  });

  it('derives deterministic PDAs matching the fixtures', () => {
    const [pda] = sdk.getInvoicePda(MOCK_WALLET, fixtureSpecs.open.invoiceId);
    expect(pda.toBase58()).toBe(OPEN);
  });

  it('waitForInvoiceState resolves when the predicate matches', async () => {
    const pda = new PublicKey(OPEN);
    const result = await sdk.waitForInvoiceState(pda, (inv) => inv.status === InvoiceStatus.Open, {
      timeoutMs: 2000,
    });
    expect(result.status).toBe(InvoiceStatus.Open);
  });
});
