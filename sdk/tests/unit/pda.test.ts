import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { TOKEN_PROGRAM_ID } from '../../src/constants';
import { getConfigPda, getEscrowAta, getInvoicePda } from '../../src/pda';
import { resolveProgramId } from '../../src/program';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const merchant = new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

describe('pda', () => {
  it('derives a deterministic config PDA', () => {
    const [a, bumpA] = getConfigPda(PROGRAM_ID);
    const [b, bumpB] = getConfigPda(PROGRAM_ID);
    expect(a.equals(b)).toBe(true);
    expect(bumpA).toBe(bumpB);
    expect(PublicKey.isOnCurve(a.toBytes())).toBe(false);
  });

  it('defaults the program id to resolveProgramId()', () => {
    const [a] = getConfigPda();
    const [b] = getConfigPda(resolveProgramId());
    expect(a.equals(b)).toBe(true);
  });

  it('matches a manual derive with [config] seed', () => {
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
    expect(getConfigPda(PROGRAM_ID)[0].equals(expected)).toBe(true);
  });

  it('derives invoice PDA with LE u64 seeds and matches manual derivation', () => {
    for (const id of [1n, 256n, 2n ** 64n - 1n]) {
      const [pda] = getInvoicePda(merchant, id, PROGRAM_ID);
      const seed = Buffer.alloc(8);
      seed.writeBigUInt64LE(id);
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('invoice'), merchant.toBuffer(), seed],
        PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    }
  });

  it('id 1n and 256n produce distinct PDAs (LE, not BE)', () => {
    const [a] = getInvoicePda(merchant, 1n, PROGRAM_ID);
    const [b] = getInvoicePda(merchant, 256n, PROGRAM_ID);
    expect(a.equals(b)).toBe(false);
    // 1n LE is 01 00.. ; 256n LE is 00 01.. ; BE of 1n would be 00..01.
    const [manualLe] = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchant.toBuffer(), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])],
      PROGRAM_ID,
    );

    expect(a.equals(manualLe)).toBe(true);
  });

  it('rejects negative and out-of-range invoice ids', () => {
    expect(() => getInvoicePda(merchant, -1n, PROGRAM_ID)).toThrow();
    expect(() => getInvoicePda(merchant, 2n ** 64n, PROGRAM_ID)).toThrow();
  });

  it('escrow ATA equals spl-token getAssociatedTokenAddressSync(mint, pda, true)', () => {
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    const escrow = getEscrowAta(invoicePda, mint);
    const expected = getAssociatedTokenAddressSync(mint, invoicePda, true, TOKEN_PROGRAM_ID);
    expect(escrow.equals(expected)).toBe(true);
  });

  it('accepts a Keypair merchant', () => {
    const kp = Keypair.generate();
    const [a] = getInvoicePda(kp.publicKey, 0n, PROGRAM_ID);
    const [b] = getInvoicePda(kp.publicKey, 0n, PROGRAM_ID);
    expect(a.equals(b)).toBe(true);
  });
});
