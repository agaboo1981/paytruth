import { PublicKey } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';

import { fixtureSpecs } from './fixtures';

const mocks = vi.hoisted(() => ({
  getBoundClient: vi.fn(() => ({ wallet: null })),
}));

vi.mock('../../../lib/paytruth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/paytruth')>()),
  getBoundClient: mocks.getBoundClient,
}));
vi.mock('./client', () => ({ isMock: false }));

import { stagedWrites } from './staged-writes';

describe('stagedWrites in real mode', () => {
  it('requires a bound wallet before sending', async () => {
    const invoicePda = new PublicKey(fixtureSpecs.open.pda);
    await expect(
      stagedWrites.payInvoice({ invoicePda, amount: 25_000_000n, expectedAmountDue: 25_000_000n }),
    ).rejects.toThrow('Connect a wallet first.');
  });
});
