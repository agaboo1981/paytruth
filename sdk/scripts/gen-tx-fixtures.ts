/**
 * Generate SYNTHETIC getTransaction-shaped fixtures for the indexer tests.
 *
 * These are NOT recorded from a real cluster — they are built from the real
 * instruction builders and real borsh-encoded "Program data:" event logs, so
 * the byte layout matches what the program will emit. Replace them with
 * recorded localnet transactions once the program is deployed.
 */
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { BorshInstructionCoder } from '@anchor-lang/core';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const here = dirname(fileURLToPath(import.meta.url));
const PAYTRUTH_IDL = JSON.parse(
  readFileSync(join(here, '..', 'src', 'idl', 'paytruth.json'), 'utf8'),
) as {
  address: string;
  instructions: { name: string; discriminator: number[]; accounts: { name: string }[]; args: { name: string }[] }[];
  types: unknown[];
  events: unknown[];
};

const PROGRAM_ID = new PublicKey(PAYTRUTH_IDL.address);
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = new PublicKey('11111111111111111111111111111111');

const merchant = new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
const payer = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const invoicePda = new PublicKey('So11111111111111111111111111111111111111112');
const OTHER = new PublicKey('11111111111111111111111111111112');

const outDir = join(here, '..', 'tests', 'fixtures', 'tx');
mkdirSync(outDir, { recursive: true });

const ixCoder = new BorshInstructionCoder(PAYTRUTH_IDL as never);

// ---- borsh event encoding (manual, deterministic) --------------------------
class BorshWriter {
  private parts: number[] = [];
  u8(n: number) {
    this.parts.push(n & 0xff);
    return this;
  }
  u64(n: bigint) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    this.parts.push(...b);
    return this;
  }
  i64(n: bigint) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(n);
    this.parts.push(...b);
    return this;
  }
  pubkey(pk: PublicKey) {
    this.parts.push(...pk.toBuffer());
    return this;
  }
  bytes(): Buffer {
    return Buffer.from(this.parts);
  }
}

function eventDisc(name: string): Buffer {
  return createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
}

function encodeEvent(name: string, body: (w: BorshWriter) => void): string {
  const w = new BorshWriter();
  body(w);
  const payload = Buffer.concat([eventDisc(name), w.bytes()]);
  return 'Program data: ' + payload.toString('base64');
}

const TS = 1_700_000_000n;

// ---- account key maps ------------------------------------------------------
interface FixtureArgs {
  name: string;
  amount: bigint;
  err: unknown | null;
  logs?: string[];
  extraIx?: TransactionInstruction[];
  feePayer: PublicKey;
}

async function buildPayInvoiceIx(
  params: {
    payer: PublicKey;
    invoicePda: PublicKey;
    mint: PublicKey;
    amount: bigint;
    expectedAmountDue: bigint;
  },
  programId: PublicKey,
): Promise<TransactionInstruction> {
  const discriminator = Buffer.from(
    PAYTRUTH_IDL.instructions.find((i) => i.name === 'pay_invoice')!.discriminator,
  );
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(params.amount);
  const expectedBuf = Buffer.alloc(8);
  expectedBuf.writeBigUInt64LE(params.expectedAmountDue);
  const data = Buffer.concat([discriminator, amountBuf, expectedBuf]);

  const config = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
  const escrow = getAssociatedTokenAddressSync(params.mint, params.invoicePda, true);
  const payerAta = getAssociatedTokenAddressSync(params.mint, params.payer, false);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: params.invoicePda, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: payerAta, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function makePayTx({ name, amount, err, logs = [], extraIx = [], feePayer }: FixtureArgs) {
  const payIx = await buildPayInvoiceIx(
    { payer, invoicePda, mint, amount, expectedAmountDue: 5_000_000n },
    PROGRAM_ID,
  );
  const ix = new TransactionInstruction({
    programId: payIx.programId,
    keys: payIx.keys,
    data: payIx.data,
  });
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = '11111111111111111111111111111111';
  if (extraIx.length) tx.add(...extraIx);
  tx.add(ix);

  const message = tx.compileMessage();
  const accountKeys = message.accountKeys;
  const allKeys = accountKeys.map((k, i) => ({
    pubkey: k.toBase58(),
    signer: message.header.numRequiredSignatures > i,
    writable: i < message.header.numRequiredSignatures - message.header.numReadonlySignedAccounts ||
      (i >= message.header.numRequiredSignatures &&
        i < accountKeys.length - message.header.numReadonlyUnsignedAccounts),
    source: i < message.header.numRequiredSignatures ? 'transaction' : 'transaction',
  }));

  const logMessages = [
    `Program ${PROGRAM_ID.toBase58()} invoke [1]`,
    `Program log: Instruction: PayInvoice`,
    ...logs,
    err
      ? `Program ${PROGRAM_ID.toBase58()} failed: custom program error: 0x${((err as { InstructionError: [number, { Custom: number }] }).InstructionError[1].Custom).toString(16)}`
      : `Program ${PROGRAM_ID.toBase58()} success`,
  ];

  const fixture = {
    __synthetic: true,
    __note: 'Synthetic fixture generated by scripts/gen-tx-fixtures.ts; not a real cluster transaction.',
    slot: 1,
    blockTime: 1_700_000_000,
    version: 'legacy',
    transaction: {
      signatures: [Buffer.alloc(64, 1).toString('base64')],
      message: Buffer.from(message.serialize()).toString('base64'),
    },
    meta: {
      err,
      fee: 5000,
      preBalances: accountKeys.map(() => 1_000_000_000),
      postBalances: accountKeys.map(() => 1_000_000_000),
      innerInstructions: [],
      logMessages,
      loadedAddresses: { writable: [], readonly: [] },
      preTokenBalances: [],
      postTokenBalances: [],
      computeUnitsConsumed: 0,
    },
  };

  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  return { allKeys, message };
}

async function main() {
  // Decode sanity: ensure the instruction coder round-trips the pay ix.
  const probe = await buildPayInvoiceIx(
    { payer, invoicePda, mint, amount: 5_000_000n, expectedAmountDue: 5_000_000n },
    PROGRAM_ID,
  );
  const decoded = ixCoder.decode(probe.data);
  if (!decoded || decoded.name !== 'pay_invoice') {
    throw new Error('instruction coder could not decode the pay_invoice builder output');
  }

  // paid exact
  await makePayTx({
    name: 'paid-exact',
    amount: 5_000_000n,
    feePayer: payer,
    err: null,
    logs: [
      encodeEvent('InvoicePaid', (w) => {
        w.pubkey(invoicePda).pubkey(payer).u64(5_000_000n).u64(0n).i64(TS);
      }),
    ],
  });

  // overpaid
  await makePayTx({
    name: 'overpaid',
    amount: 6_000_000n,
    feePayer: payer,
    err: null,
    logs: [
      encodeEvent('InvoicePaid', (w) => {
        w.pubkey(invoicePda).pubkey(payer).u64(6_000_000n).u64(1_000_000n).i64(TS);
      }),
    ],
  });

  // failed Underpayment (6000)
  await makePayTx({
    name: 'failed-underpayment',
    amount: 4_000_000n,
    feePayer: payer,
    err: { InstructionError: [0, { Custom: 6000 }] },
    logs: [
      'Program log: AnchorError occurred. Error Code: Underpayment. Error Number: 6000. Error Message: underpaid.',
    ],
  });

  // failed InvoiceExpired (6003)
  await makePayTx({
    name: 'failed-expired',
    amount: 5_000_000n,
    feePayer: payer,
    err: { InstructionError: [0, { Custom: 6003 }] },
    logs: [
      'Program log: AnchorError occurred. Error Code: InvoiceExpired. Error Number: 6003. Error Message: expired.',
    ],
  });

  // failed InvoiceMismatch (6022): terms changed since the payer loaded them
  await makePayTx({
    name: 'failed-invoice-mismatch',
    amount: 5_000_000n,
    feePayer: payer,
    err: { InstructionError: [0, { Custom: 6022 }] },
    logs: [
      'Program log: AnchorError occurred. Error Code: InvoiceMismatch. Error Number: 6022. Error Message: The invoice changed since you loaded it; reload and try again.',
    ],
  });

  // double-pay (second pay fails DuplicatePayment 6001)
  await makePayTx({
    name: 'double-pay',
    amount: 5_000_000n,
    feePayer: payer,
    err: { InstructionError: [0, { Custom: 6001 }] },
    logs: [
      'Program log: AnchorError occurred. Error Code: DuplicatePayment. Error Number: 6001. Error Message: not open.',
    ],
  });

  // unattributed direct SPL transfer to escrow (no pay_invoice instruction)
  {
    const escrow = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchant.toBuffer(), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])],
      PROGRAM_ID,
    )[0];
    // A classic SPL transfer instruction (programId == TOKEN), NOT our program.
    const transferIx = new TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: OTHER, isSigner: false, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([12, 0, 128, 132, 94, 0, 0, 0, 0]), // transfer_checked-ish placeholder
    });
    const tx = new Transaction();
    tx.feePayer = payer;
    tx.recentBlockhash = '11111111111111111111111111111111';
    tx.add(transferIx);
    const message = tx.compileMessage();
    const accountKeys = message.accountKeys;
    const fixture = {
      __synthetic: true,
      __note: 'Synthetic fixture generated by scripts/gen-tx-fixtures.ts; not a real cluster transaction.',
      slot: 2,
      blockTime: 1_700_000_001,
      version: 'legacy',
      transaction: {
        signatures: [Buffer.alloc(64, 2).toString('base64')],
        message: Buffer.from(message.serialize()).toString('base64'),
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: accountKeys.map(() => 1_000_000_000),
        postBalances: accountKeys.map(() => 1_000_000_000),
        innerInstructions: [],
        logMessages: [
          `Program ${TOKEN.toBase58()} invoke [1]`,
          `Program ${TOKEN.toBase58()} success`,
        ],
        loadedAddresses: { writable: [], readonly: [] },
        preTokenBalances: [],
        postTokenBalances: [],
        computeUnitsConsumed: 0,
      },
    };
    writeFileSync(join(outDir, 'unattributed-transfer.json'), JSON.stringify(fixture, null, 2) + '\n');
  }

  // A non-payment transaction (System transfer) to the merchant.
  {
    const sysIx = new TransactionInstruction({
      programId: SYSTEM,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: merchant, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    });
    const tx = new Transaction();
    tx.feePayer = payer;
    tx.recentBlockhash = '11111111111111111111111111111111';
    tx.add(sysIx);
    const message = tx.compileMessage();
    const accountKeys = message.accountKeys;
    const fixture = {
      __synthetic: true,
      __note: 'Synthetic fixture generated by scripts/gen-tx-fixtures.ts; not a real cluster transaction.',
      slot: 3,
      blockTime: 1_700_000_002,
      version: 'legacy',
      transaction: {
        signatures: [Buffer.alloc(64, 3).toString('base64')],
        message: Buffer.from(message.serialize()).toString('base64'),
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: accountKeys.map(() => 1_000_000_000),
        postBalances: accountKeys.map(() => 1_000_000_000),
        innerInstructions: [],
        logMessages: [`Program ${SYSTEM.toBase58()} invoke [1]`, `Program ${SYSTEM.toBase58()} success`],
        loadedAddresses: { writable: [], readonly: [] },
        preTokenBalances: [],
        postTokenBalances: [],
        computeUnitsConsumed: 0,
      },
    };
    writeFileSync(join(outDir, 'not-a-payment.json'), JSON.stringify(fixture, null, 2) + '\n');
  }

  console.log(`wrote synthetic fixtures to ${outDir}`);
}

void main();
