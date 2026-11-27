import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IDL_SOURCE, PAYTRUTH_IDL } from '../../src/idl';

function disc(prefix: string, name: string): number[] {
  return Array.from(createHash('sha256').update(`${prefix}${name}`).digest().subarray(0, 8));
}

const EXPECTED_ACCOUNT_ORDER: Record<string, string[]> = {
  initialize_config: ['authority', 'config', 'usdc_mint', 'system_program'],
  create_invoice: [
    'merchant',
    'config',
    'invoice',
    'mint',
    'escrow',
    'token_program',
    'associated_token_program',
    'system_program',
  ],
  pay_invoice: ['payer', 'config', 'invoice', 'mint', 'payer_ata', 'escrow', 'token_program'],
  merchant_claim: [
    'merchant',
    'invoice',
    'mint',
    'escrow',
    'merchant_ata',
    'token_program',
    'associated_token_program',
    'system_program',
  ],
  refund_overpayment: [
    'caller',
    'invoice',
    'mint',
    'escrow',
    'payer',
    'payer_ata',
    'token_program',
    'associated_token_program',
    'system_program',
  ],
  expire_invoice: ['caller', 'invoice'],
  recover_unattributed: [
    'merchant',
    'invoice',
    'mint',
    'escrow',
    'destination_ata',
    'token_program',
    'associated_token_program',
    'system_program',
  ],
  close_invoice: ['merchant', 'invoice', 'mint', 'escrow', 'token_program'],
};

describe('real anchor idl', () => {
  it('declares the anchor-4252df8 source and program address', () => {
    expect(IDL_SOURCE).toBe('anchor-4252df8');
    expect(PAYTRUTH_IDL.address).toBe('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
    expect(PAYTRUTH_IDL.metadata.spec).toBe('0.1.0');
  });

  it('every instruction discriminator equals sha256("global:<name>")[0..8]', () => {
    for (const ix of PAYTRUTH_IDL.instructions) {
      expect(ix.discriminator, ix.name).toEqual(disc('global:', ix.name));
    }
  });

  it('every account discriminator equals sha256("account:<Name>")[0..8]', () => {
    expect(PAYTRUTH_IDL.accounts.map((a) => a.name)).toEqual(['Config', 'Invoice']);
    for (const acct of PAYTRUTH_IDL.accounts) {
      expect(acct.discriminator, acct.name).toEqual(disc('account:', acct.name));
    }
  });

  it('every event discriminator equals sha256("event:<Name>")[0..8]', () => {
    for (const ev of PAYTRUTH_IDL.events) {
      expect(ev.discriminator, ev.name).toEqual(disc('event:', ev.name));
    }
  });

  it('account order per instruction matches the spec', () => {
    expect(PAYTRUTH_IDL.instructions.map((i) => i.name).sort()).toEqual(
      Object.keys(EXPECTED_ACCOUNT_ORDER).sort(),
    );
    for (const ix of PAYTRUTH_IDL.instructions) {
      expect(
        ix.accounts.map((a) => a.name),
        ix.name,
      ).toEqual(EXPECTED_ACCOUNT_ORDER[ix.name]);
    }
  });

  it('has error codes 6000..6022 with the exact names', () => {
    const names = PAYTRUTH_IDL.errors.map((e) => e.name);
    expect(PAYTRUTH_IDL.errors[0]!.code).toBe(6000);
    expect(PAYTRUTH_IDL.errors.at(-1)!.code).toBe(6022);
    expect(names).toEqual([
      'Underpayment',
      'DuplicatePayment',
      'InvoiceNotOpen',
      'InvoiceExpired',
      'InvoiceNotPaid',
      'AlreadyClaimed',
      'AlreadyRefunded',
      'NothingToRefund',
      'NotExpired',
      'InvalidAmount',
      'InvalidExpiry',
      'InvalidMint',
      'InvalidEscrow',
      'UnauthorizedMerchant',
      'InvalidPayerAta',
      'Overflow',
      'VaultNotEmpty',
      'InvoiceNotTerminal',
      'ExcessOutstanding',
      'NothingToRecover',
      'PayerNotRecorded',
      'ConfigMintMismatch',
      'InvoiceMismatch',
    ]);
  });

  it('pay_invoice binds amount and expected_amount_due; payer is a read-only signer', () => {
    const ix = PAYTRUTH_IDL.instructions.find((i) => i.name === 'pay_invoice')!;
    expect(ix.args.map((a) => a.name)).toEqual(['amount', 'expected_amount_due']);
    const payer = ix.accounts.find((a) => a.name === 'payer')!;
    expect(payer.signer).toBe(true);
    expect(Boolean(payer.writable)).toBe(false);
    const refund = PAYTRUTH_IDL.instructions.find((i) => i.name === 'refund_overpayment')!;
    const refundPayer = refund.accounts.find((a) => a.name === 'payer')!;
    expect(Boolean(refundPayer.writable)).toBe(false);
    expect(refundPayer.signer).toBeFalsy();
  });
});
