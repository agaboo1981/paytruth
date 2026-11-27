import { PublicKey } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';

import type { WriteOptions } from '../../../lib/paytruth';

import { fixtureSpecs } from './fixtures';

const mocks = vi.hoisted(() => ({
  payInvoice: vi.fn(async () => ({ signature: 'mock-signature' })),
}));

vi.mock('./client', () => ({ isMock: true }));
vi.mock('./mock-sdk', () => ({ mockSdk: mocks }));

import { stagedWrites } from './staged-writes';

describe('stagedWrites in mock mode', () => {
  it('forwards arguments and write options to the mock SDK', async () => {
    const invoicePda = new PublicKey(fixtureSpecs.open.pda);
    const args = { invoicePda, amount: 25_000_000n, expectedAmountDue: 25_000_000n };
    const opts: WriteOptions = { onStage: vi.fn(), onSigned: vi.fn() };

    const result = await stagedWrites.payInvoice(args, opts);

    expect(mocks.payInvoice).toHaveBeenCalledWith(args, opts);
    expect(result).toEqual({ signature: 'mock-signature' });
  });
});
