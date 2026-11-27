import { PublicKey } from '@solana/web3.js';

import { MOCK_PROGRAM_ID, MOCK_USDC_MINT } from './mock-config';

export const MOCK_WALLET = new PublicKey('7rQNw7k4dY6mJf2sT9zXbC3vLp8HnKqE5uWaYdR6gXcS');
export const MOCK_PAYER = new PublicKey('9mKq3xVdR7pLzB2nWf5sHa8yTj4cEu6Qo1iGvXbN3rDz');

export const MOCK_PROGRAM = new PublicKey(MOCK_PROGRAM_ID);
export const MOCK_MINT = new PublicKey(MOCK_USDC_MINT);

export type FixtureLabel = 'open' | 'paid' | 'overpaid' | 'claimed' | 'expired' | 'expiring';

export type FixtureSpec = {
  label: FixtureLabel;
  invoiceId: bigint;
  amountDue: bigint;
  memo: string;
  pda: string;
  payer?: PublicKey;
  paidAmount?: bigint;
  refundedExcess?: bigint;
  claimed?: boolean;
  status: 0 | 1 | 2;
  expiresOffsetSec: number;
  createdAt: bigint;
};

const NOW = BigInt(Math.floor(Date.now() / 1000));
const DAY = 86400n;

function pda(merchant: PublicKey, invoiceId: bigint): string {
  const idBytes = new Uint8Array(8);
  let value = invoiceId;
  for (let i = 0; i < 8; i += 1) {
    idBytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  const [address] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('invoice'), merchant.toBuffer(), idBytes],
    MOCK_PROGRAM,
  );
  return address.toBase58();
}

function spec(partial: Omit<FixtureSpec, 'pda'>): FixtureSpec {
  return { ...partial, pda: pda(MOCK_WALLET, partial.invoiceId) };
}

export const fixtureSpecs: Record<FixtureLabel, FixtureSpec> = {
  open: spec({
    label: 'open',
    invoiceId: 1001n,
    amountDue: 25_000_000n,
    memo: 'Logo design – 2 rounds',
    status: 0,
    expiresOffsetSec: 2 * Number(DAY),
    createdAt: NOW - DAY / 2n,
  }),
  paid: spec({
    label: 'paid',
    invoiceId: 1002n,
    amountDue: 120_000_000n,
    memo: 'Website landing page build',
    status: 1,
    payer: MOCK_PAYER,
    paidAmount: 120_000_000n,
    expiresOffsetSec: 3 * Number(DAY),
    createdAt: NOW - DAY,
  }),
  overpaid: spec({
    label: 'overpaid',
    invoiceId: 1003n,
    amountDue: 40_000_000n,
    memo: 'Brand illustration set',
    status: 1,
    payer: MOCK_PAYER,
    paidAmount: 45_500_000n,
    expiresOffsetSec: 5 * Number(DAY),
    createdAt: NOW - DAY,
  }),
  claimed: spec({
    label: 'claimed',
    invoiceId: 1004n,
    amountDue: 75_000_000n,
    memo: 'SaaS dashboard redesign',
    status: 1,
    payer: MOCK_PAYER,
    paidAmount: 75_000_000n,
    claimed: true,
    expiresOffsetSec: 4 * Number(DAY),
    createdAt: NOW - 2n * DAY,
  }),
  expired: spec({
    label: 'expired',
    invoiceId: 1005n,
    amountDue: 15_000_000n,
    memo: 'Podcast cover art',
    status: 2,
    expiresOffsetSec: -Number(DAY),
    createdAt: NOW - 3n * DAY,
  }),
  expiring: spec({
    label: 'expiring',
    invoiceId: 1006n,
    amountDue: 9_500_000n,
    memo: 'Business card layout',
    status: 0,
    expiresOffsetSec: -3600,
    createdAt: NOW - 2n * DAY,
  }),
};

export const MOCK_FIXTURES = fixtureSpecs;

export const FIXTURE_LABELS: FixtureLabel[] = [
  'open',
  'paid',
  'overpaid',
  'claimed',
  'expired',
  'expiring',
];

export function fixturePda(label: FixtureLabel): string {
  return fixtureSpecs[label].pda;
}
