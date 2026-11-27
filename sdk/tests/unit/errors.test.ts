import { AnchorError, ProgramError } from '@anchor-lang/core';
import { SendTransactionError } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { PAYTRUTH_ERRORS, mapError } from '../../src/errors';
import { mapToPaytruthError } from '../../src/send';

describe('PAYTRUTH_ERRORS table', () => {
  it('covers codes 6000..6022 with names and messages', () => {
    for (let code = 6000; code <= 6022; code++) {
      const entry = PAYTRUTH_ERRORS[code];
      expect(entry, `missing ${code}`).toBeDefined();
      expect(entry!.code).toBe(code);
      expect(typeof entry!.name).toBe('string');
      expect(entry!.name.length).toBeGreaterThan(0);
      expect(entry!.message.length).toBeGreaterThan(0);
    }
  });

  it('has the exact names from PROGRAM-SPEC', () => {
    const names = [
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
    ];
    names.forEach((name, i) => {
      expect(PAYTRUTH_ERRORS[6000 + i]!.name).toBe(name);
    });
  });

  it('gives InvoiceMismatch a reload-first message', () => {
    expect(PAYTRUTH_ERRORS[6022]!.message).toBe(
      'The invoice changed since you loaded it; reload and try again.',
    );
  });
});

describe('mapError', () => {
  it('maps every code 6000..6022 to a program error by code number', () => {
    for (let code = 6000; code <= 6022; code++) {
      const mapped = mapError({ InstructionError: [0, { Custom: code }] });
      expect(mapped.kind).toBe('program');
      expect(mapped.code).toBe(code);
      expect(mapped.name).toBe(PAYTRUTH_ERRORS[code]!.name);
    }
  });

  it('maps 6022 InvoiceMismatch as non-retryable without a reload', () => {
    const mapped = mapError({ InstructionError: [0, { Custom: 6022 }] });
    expect(mapped.kind).toBe('program');
    expect(mapped.code).toBe(6022);
    expect(mapped.name).toBe('InvoiceMismatch');
    expect(mapped.message).toBe('The invoice changed since you loaded it; reload and try again.');
    expect(mapped.retryable).toBe(false);
  });

  it('preserves mapped program errors through mapToPaytruthError', () => {
    const wrapped = mapToPaytruthError({ InstructionError: [0, { Custom: 6001 }] });
    const mapped = mapError(wrapped);
    expect(mapped.kind).toBe('program');
    expect(mapped.code).toBe(6001);
    expect(mapped.name).toBe('DuplicatePayment');
  });

  it('parses a log-line AnchorError', () => {
    const logs = [
      'Program D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H invoke [1]',
      'Program log: AnchorError occurred. Error Code: DuplicatePayment. Error Number: 6001. Error Message: invoice is not Open.',
      'Program D8dnG9j1zSwwaJLyAp794MJqEXptdiVS74gh6fNLQ7H failed: custom program error: 0x1771',
    ];
    const err = new SendTransactionError({ action: 'send', signature: '', transactionMessage: 'msg', logs });
    const mapped = mapError(err);
    expect(mapped.kind).toBe('program');
    expect(mapped.code).toBe(6001);
    expect(mapped.name).toBe('DuplicatePayment');
  });

  it('parses hex "custom program error: 0x1771" (=6001)', () => {
    const mapped = mapError('Transaction failed: custom program error: 0x1771');
    expect(mapped.code).toBe(6001);
    expect(mapped.name).toBe('DuplicatePayment');
  });

  it('parses 0x1770 (=6000 Underpayment)', () => {
    const mapped = mapError(new Error('custom program error: 0x1770'));
    expect(mapped.code).toBe(6000);
    expect(mapped.name).toBe('Underpayment');
  });

  it('handles a raw InstructionError object', () => {
    const mapped = mapError({ InstructionError: [2, { Custom: 6003 }] });
    expect(mapped.kind).toBe('program');
    expect(mapped.code).toBe(6003);
    expect(mapped.name).toBe('InvoiceExpired');
  });

  it('maps Anchor framework codes 2000-2999 as anchor kind', () => {
    const mapped = mapError({ InstructionError: [0, { Custom: 2006 }] });
    expect(mapped.kind).toBe('anchor');
    expect(mapped.code).toBe(2006);
    expect(mapped.retryable).toBe(false);
  });

  it('maps Anchor code 3012 AccountNotInitialized as anchor kind', () => {
    const mapped = mapError({ InstructionError: [0, { Custom: 3012 }] });
    expect(mapped.kind).toBe('anchor');
    expect(mapped.code).toBe(3012);
    expect(mapped.name).toBe('AccountNotInitialized');
  });

  it('maps an AnchorError instance', () => {
    const anchorErr = new AnchorError(
      { code: 'Underpayment', number: 6000 } as never,
      'underpaid',
      ['Program log: AnchorError'],
      ['Program log: AnchorError'],
      undefined,
      undefined,
    );
    const mapped = mapError(anchorErr);
    expect(mapped.kind).toBe('program');
    expect(mapped.code).toBe(6000);
    expect(mapped.name).toBe('Underpayment');
  });

  it('maps a ProgramError instance with code', () => {
    const pe = new ProgramError(6001, 'DuplicatePayment');
    const mapped = mapError(pe);
    expect(mapped.kind).toBe('program');
    expect(mapped.code).toBe(6001);
  });

  it('maps System "already in use" to an invoice-exists friendly message', () => {
    const mapped = mapError(
      new Error('Allocate: account Address { address: X } already in use: custom program error: 0x0'),
    );
    expect(mapped.message.toLowerCase()).toContain('invoice with this id already exists');
  });

  it('maps SPL Token InsufficientFunds (0x1) from token program to not enough USDC', () => {
    const logs = [
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1',
    ];
    const err = new SendTransactionError({ action: 'send', signature: '', transactionMessage: 'msg', logs });
    const mapped = mapError(err);
    expect(mapped.kind).toBe('token');
    expect(mapped.message.toLowerCase()).toContain('not enough usdc');
  });

  it('maps wallet-adapter rejection by name', () => {
    const e = new Error('User rejected the request.');
    e.name = 'WalletSignTransactionError';
    const mapped = mapError(e);
    expect(mapped.kind).toBe('wallet');
    expect(mapped.name).toBe('WalletSignTransactionError');
    expect(mapped.retryable).toBe(false);
  });

  it('maps WalletNotConnectedError', () => {
    const e = new Error('not connected');
    e.name = 'WalletNotConnectedError';
    expect(mapError(e).kind).toBe('wallet');
  });

  it('maps blockhash-not-found / block height exceeded as retryable rpc', () => {
    const a = mapError(new Error('Blockhash not found'));
    expect(a.kind).toBe('rpc');
    expect(a.retryable).toBe(true);
    const b = mapError(new Error('Transaction block height exceeded'));
    expect(b.kind).toBe('rpc');
    expect(b.retryable).toBe(true);
  });

  it('maps 429 rate limit as retryable rpc', () => {
    const mapped = mapError(new Error('429 Too Many Requests'));
    expect(mapped.kind).toBe('rpc');
    expect(mapped.retryable).toBe(true);
  });

  it('maps "Attempt to debit an account but found no record of a prior credit" to need SOL', () => {
    const mapped = mapError(new Error('Attempt to debit an account but found no record of a prior credit'));
    expect(mapped.message.toLowerCase()).toContain('sol');
  });

  it('returns unknown for unrecognized errors', () => {
    const mapped = mapError(new Error('something weird'));
    expect(mapped.kind).toBe('unknown');
    expect(mapped.retryable).toBe(false);
  });

  it('handles null/undefined/string inputs', () => {
    expect(mapError(null).kind).toBe('unknown');
    expect(mapError(undefined).kind).toBe('unknown');
    expect(mapError('random string').kind).toBe('unknown');
  });
});
