import { describe, expect, it } from 'vitest';

import {
  FeePayerUnfundedError,
  InvoiceClosedError,
  InvoiceExpiredError,
  InvoiceNotFoundError,
  MainnetRefusedError,
  TxTimeoutError,
  WalletModifiedTransactionError,
} from '../../../lib/paytruth';

import { lookupProgramError, lookupProgramErrorByName, mapTxError, PROGRAM_ERRORS } from './tx-errors';

describe('PROGRAM_ERRORS map', () => {
  it('covers every code from 6000 to 6021', () => {
    for (let code = 6000; code <= 6021; code += 1) {
      expect(PROGRAM_ERRORS[code], `missing code ${code}`).toBeDefined();
      expect(PROGRAM_ERRORS[code].name.length).toBeGreaterThan(0);
      expect(PROGRAM_ERRORS[code].message.length).toBeGreaterThan(0);
    }
  });

  it('returns null above the mapped range', () => {
    expect(lookupProgramError(6100)).toBeNull();
  });
});

describe('mapTxError program codes', () => {
  it('maps Error Code name to a plain sentence and keeps the name as code', () => {
    expect(
      mapTxError(new Error('AnchorError. Error Code: DuplicatePayment. Error Number: 6001. custom program error: 0x1771')),
    ).toEqual({
      phase: 'failed',
      error: {
        code: 'DuplicatePayment',
        message: 'This invoice is already paid. You were not charged again.',
        raw: 'AnchorError. Error Code: DuplicatePayment. Error Number: 6001. custom program error: 0x1771',
      },
    });
  });

  it('maps hex 0x1770 (6000) to Underpayment when no name present', () => {
    expect(
      mapTxError(new Error('Program failed: custom program error: 0x1770')),
    ).toEqual({
      phase: 'failed',
      error: {
        code: 'Underpayment',
        message: "That's less than the amount due. Nothing was sent.",
        raw: 'Program failed: custom program error: 0x1770',
      },
    });
  });

  it('maps hex 0x1773 (6003) to InvoiceExpired', () => {
    const result = mapTxError(new Error('custom program error: 0x1773'));
    expect(result.error.code).toBe('InvoiceExpired');
  });

  it('maps 0x1778 (6008) to NotExpired', () => {
    const result = mapTxError(new Error('custom program error: 0x1778'));
    expect(result.error.code).toBe('NotExpired');
  });

  it('maps VaultNotEmpty (0x1780 / 6016)', () => {
    const result = mapTxError(new Error('custom program error: 0x1780'));
    expect(result.error.code).toBe('VaultNotEmpty');
    expect(lookupProgramErrorByName('VaultNotEmpty')?.code).toBe(6016);
  });

  it('maps every 6000-6021 hex code to its name', () => {
    for (let code = 6000; code <= 6021; code += 1) {
      const hex = code.toString(16);
      const result = mapTxError(new Error(`error sending transaction: custom program error: 0x${hex}`));
      expect(result.error.code, `code ${code}`).toBe(PROGRAM_ERRORS[code].name);
    }
  });

  it('maps simulated 0x1771 with generic simulation text to DuplicatePayment', () => {
    const result = mapTxError(new Error('Simulation failed. custom program error: 0x1771'));
    expect(result.error.code).toBe('DuplicatePayment');
  });
});

describe('mapTxError core cases', () => {
  it('maps a plain cancellation message to rejected', () => {
    expect(mapTxError(new Error('User rejected the request'))).toEqual({
      phase: 'rejected',
      error: {
        code: 'USER_REJECTED',
        message: 'You cancelled in your wallet. Nothing was sent and no money moved.',
        raw: 'User rejected the request',
      },
    });
  });

  it('maps WalletSignTransactionError to rejected', () => {
    expect(mapTxError({ name: 'WalletSignTransactionError', message: 'Signing cancelled' })).toEqual({
      phase: 'rejected',
      error: {
        code: 'USER_REJECTED',
        message: 'You cancelled in your wallet. Nothing was sent and no money moved.',
        raw: 'Signing cancelled',
      },
    });
  });

  it('maps InsufficientFunds to a friendly SOL balance message', () => {
    expect(mapTxError({ name: 'InsufficientFunds', message: 'insufficient lamports' })).toEqual({
      phase: 'failed',
      error: {
        code: 'INSUFFICIENT_SOL',
        message: 'Not enough SOL to pay the network fee.',
        raw: 'insufficient lamports',
      },
    });
  });

  it('keeps a custom program error 0x1 as a program error', () => {
    expect(
      mapTxError(
        new Error(
          'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1',
        ),
      ),
    ).toEqual({
      phase: 'failed',
      error: {
        code: 'PROGRAM_ERROR',
        message: 'Simulation failed (program error 0x1).',
        raw: 'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1',
      },
    });
  });

  it('maps BlockhashNotFound to expired', () => {
    expect(mapTxError({ name: 'BlockhashNotFound', message: 'Blockhash not found' })).toEqual({
      phase: 'expired',
      error: {
        code: 'BLOCKHASH_EXPIRED',
        message: "The network didn't pick this up in time. No money moved — it's safe to try again.",
        raw: 'Blockhash not found',
      },
    });
  });

  it('maps a block height error to expired', () => {
    expect(mapTxError(new Error('Transaction failed: block height exceeded'))).toEqual({
      phase: 'expired',
      error: {
        code: 'BLOCKHASH_EXPIRED',
        message: "The network didn't pick this up in time. No money moved — it's safe to try again.",
        raw: 'Transaction failed: block height exceeded',
      },
    });
  });

  it('maps unknown objects to a generic failure with raw text', () => {
    expect(mapTxError({ code: -32000, message: 'RPC request failed' })).toEqual({
      phase: 'failed',
      error: {
        code: 'UNKNOWN',
        message: 'Transaction failed. Try again.',
        raw: 'RPC request failed',
      },
    });
  });

  it('handles null without throwing', () => {
    expect(mapTxError(null)).toEqual({
      phase: 'failed',
      error: { code: 'UNKNOWN', message: 'Transaction failed. Try again.' },
    });
  });
});

describe('mapTxError Full-Stack mapError cases', () => {
  it('maps TxTimeoutError to expired with the no-money-moved copy', () => {
    expect(mapTxError(new TxTimeoutError())).toEqual({
      phase: 'expired',
      error: {
        code: 'BLOCKHASH_EXPIRED',
        message: "The network didn't pick this up in time. No money moved — it's safe to try again.",
        raw: 'Timed out waiting for the transaction to reach the expected state.',
      },
    });
  });

  it('maps InvoiceNotFoundError on a write to the closed-invoice copy', () => {
    expect(mapTxError(new InvoiceNotFoundError('invoice'))).toEqual({
      phase: 'failed',
      error: {
        code: 'INVOICE_CLOSED',
        message: 'This invoice is closed and can no longer be paid. No money moved.',
        raw: 'Invoice not found: no invoice account exists at invoice.',
      },
    });
  });

  it('maps Anchor 3012 AccountNotInitialized to the closed-invoice copy', () => {
    const raw =
      'AnchorError. Error Code: AccountNotInitialized. Error Number: 3012. custom program error: 0xbc4';
    expect(mapTxError(new Error(raw))).toEqual({
      phase: 'failed',
      error: {
        code: 'INVOICE_CLOSED',
        message: 'This invoice is closed and can no longer be paid. No money moved.',
        raw,
      },
    });
  });

  it('maps the missing wallet message to a connect-wallet prompt', () => {
    expect(mapTxError(new Error('Connect a wallet first.'))).toEqual({
      phase: 'failed',
      error: {
        code: 'WALLET_NOT_CONNECTED',
        message: 'Connect your wallet to continue.',
        raw: 'Connect a wallet first.',
      },
    });
  });

  it('maps WalletModifiedTransactionError to a stopped-transaction message', () => {
    expect(mapTxError(new WalletModifiedTransactionError())).toEqual({
      phase: 'failed',
      error: {
        code: 'WALLET_MODIFIED',
        message: 'Your wallet changed the transaction, so we stopped it. Nothing was sent.',
        raw: 'The wallet modified the transaction in a way that is not allowed.',
      },
    });
  });

  it('maps MainnetRefusedError to the devnet-only message', () => {
    expect(mapTxError(new MainnetRefusedError())).toEqual({
      phase: 'failed',
      error: {
        code: 'MAINNET_REFUSED',
        message: 'Paytruth only runs on devnet.',
        raw: 'Paytruth refuses to run against mainnet-beta.',
      },
    });
  });

  it('maps token insufficient funds to a USDC message', () => {
    const raw = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: custom program error: 0x1';
    expect(mapTxError(new Error(raw))).toEqual({
      phase: 'failed',
      error: {
        code: 'INSUFFICIENT_USDC',
        message: 'Not enough USDC in your wallet.',
        raw,
      },
    });
  });

  it('maps an unfunded fee payer (real devnet SendTransactionError text) to the SOL copy', () => {
    const error = new Error(
      'Simulation failed. \nMessage: Transaction simulation failed: This account may not be used to pay transaction fees. \nLogs: \n[]. \nCatch the `SendTransactionError` and call `getLogs()` on it for full details.',
    );
    expect(mapTxError(error).error.code).toBe('INSUFFICIENT_SOL');
    expect(mapTxError(error).error.message).toBe(
      'This wallet needs a little SOL to pay network fees. Fund it with SOL and try again.',
    );
  });

  it('maps FS typed InvoiceClosedError / InvoiceExpiredError / FeePayerUnfundedError to FS copy', () => {
    expect(mapTxError(new InvoiceClosedError('X')).error).toMatchObject({
      code: 'INVOICE_CLOSED',
      message: 'This invoice is closed and can no longer be paid. No money moved.',
    });
    expect(mapTxError(new InvoiceExpiredError('X')).error).toMatchObject({
      code: 'INVOICE_EXPIRED',
      message: 'This invoice has expired. No money moved.',
    });
    expect(mapTxError(new FeePayerUnfundedError()).error.code).toBe('INSUFFICIENT_SOL');
  });
});
