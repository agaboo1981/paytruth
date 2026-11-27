import { mapError } from '../../../lib/paytruth';
import type { TxError, TxPhase } from './tx-machine';

export type TxFailurePhase = Extract<TxPhase, 'failed' | 'rejected' | 'expired'>;

export type MappedTxError = {
  phase: TxFailurePhase;
  error: TxError;
};

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  logs?: unknown;
  code?: unknown;
};

export type ProgramErrorCode = {
  code: number;
  name: string;
  message: string;
};

/**
 * Paytruth program error map, codes 6000-6021 from PROGRAM-SPEC.md. Each entry
 * is the single plain-language sentence the UI shows for that code.
 */
export const PROGRAM_ERRORS: Record<number, { name: string; message: string }> = {
  6000: { name: 'Underpayment', message: "That's less than the amount due. Nothing was sent." },
  6001: { name: 'DuplicatePayment', message: 'This invoice is already paid. You were not charged again.' },
  6002: { name: 'InvoiceNotOpen', message: 'This invoice is no longer open, so that action cannot run.' },
  6003: { name: 'InvoiceExpired', message: "This invoice has expired and can't be paid." },
  6004: { name: 'InvoiceNotPaid', message: 'This invoice has not been paid yet, so there is nothing to do here.' },
  6005: { name: 'AlreadyClaimed', message: 'This payment was already claimed. You were not charged twice.' },
  6006: { name: 'AlreadyRefunded', message: 'This overpayment was already refunded.' },
  6007: { name: 'NothingToRefund', message: 'There is no extra payment to refund.' },
  6008: { name: 'NotExpired', message: "This invoice has not reached its expiry time yet." },
  6009: { name: 'InvalidAmount', message: 'That amount is not valid. Enter an amount greater than zero.' },
  6010: { name: 'InvalidExpiry', message: 'The expiry time must be in the future.' },
  6011: { name: 'InvalidMint', message: 'That is not the supported USDC token on devnet.' },
  6012: { name: 'InvalidEscrow', message: 'The escrow account for this invoice does not match.' },
  6013: { name: 'UnauthorizedMerchant', message: 'Only the merchant wallet can do this.' },
  6014: { name: 'InvalidPayerAta', message: 'That token account does not belong to the right wallet.' },
  6015: { name: 'Overflow', message: 'The amounts were too large to process.' },
  6016: { name: 'VaultNotEmpty', message: 'The escrow still holds funds, so it cannot be closed yet.' },
  6017: { name: 'InvoiceNotTerminal', message: 'This invoice is not finished yet, so it cannot be closed or recovered.' },
  6018: { name: 'ExcessOutstanding', message: 'The extra payment must be refunded before you can close.' },
  6019: { name: 'NothingToRecover', message: 'There are no leftover funds to recover.' },
  6020: { name: 'PayerNotRecorded', message: 'This invoice has no recorded payer yet.' },
  6021: { name: 'ConfigMintMismatch', message: 'That token does not match the configured USDC on devnet.' },
};

const ANCHOR_BASE = 6000;

export function lookupProgramError(code: number): ProgramErrorCode | null {
  const entry = PROGRAM_ERRORS[code];
  if (!entry) return null;
  return { code, name: entry.name, message: entry.message };
}

export function lookupProgramErrorByName(name: string): ProgramErrorCode | null {
  for (const [rawCode, entry] of Object.entries(PROGRAM_ERRORS)) {
    if (entry.name === name) return { code: Number(rawCode), name: entry.name, message: entry.message };
  }
  return null;
}

function readRecord(error: unknown): ErrorLike | null {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : null;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const message = readRecord(error)?.message;
  return typeof message === 'string' ? message : '';
}

function searchText(error: unknown): string {
  const record = readRecord(error);
  const name = typeof record?.name === 'string' ? record.name : '';
  const code = record?.code === undefined ? '' : String(record.code);
  const logs = Array.isArray(record?.logs)
    ? record.logs.filter((entry): entry is string => typeof entry === 'string').join(' ')
    : '';
  return [name, readMessage(error), code, logs].join(' ');
}

function extractProgramError(text: string): ProgramErrorCode | null {
  const nameMatch = text.match(/Error Code:\s*([A-Za-z][A-Za-z0-9]*)/);
  if (nameMatch) {
    const byName = lookupProgramErrorByName(nameMatch[1]);
    if (byName) return byName;
  }

  const hexMatch = text.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
  if (hexMatch) {
    const numeric = Number.parseInt(hexMatch[1], 16);
    if (numeric >= ANCHOR_BASE) {
      const byCode = lookupProgramError(numeric);
      if (byCode) return byCode;
    }
  }

  const anchorNumber = text.match(/Error Number:\s*(\d+)/);
  if (anchorNumber) {
    const byCode = lookupProgramError(Number(anchorNumber[1]));
    if (byCode) return byCode;
  }

  return null;
}

export function mapTxError(error: unknown): MappedTxError {
  const mapped = mapError(error);
  const message = readMessage(error);
  const text = searchText(error);
  const lower = `${text} ${mapped.name ?? ''} ${mapped.message}`.toLowerCase();
  const raw = message.length > 0 ? message : undefined;
  const hasInsufficientContext =
    /insufficientfunds|insufficient\s*(funds|lamports|sol)|not enough sol|needs sol|no record of a prior credit/.test(
      lower,
    );
  const hasProgramErrorContext =
    /instructionerror|simulation failed|custom program error|program error/.test(lower);

  function result(phase: TxFailurePhase, code: string, friendly: string): MappedTxError {
    return {
      phase,
      error: { code, message: friendly, ...(raw ? { raw } : {}) },
    };
  }

  const walletRejection =
    (mapped.kind === 'wallet' && /reject|cancel|closed|disconnect|did not respond/.test(lower)) ||
    /walletsigntransactionerror|user rejected|rejected the request|rejected by user|signing cancelled|signing canceled/.test(
      lower,
    );
  if (walletRejection) {
    return result('rejected', 'USER_REJECTED', 'You cancelled in your wallet. Nothing was sent and no money moved.');
  }

  if (
    /timeout|timed out|blockhashnotfound|blockhash not found|block height exceeded|blockhash.*expired/.test(
      lower,
    )
  ) {
    return result(
      'expired',
      'BLOCKHASH_EXPIRED',
      "The network didn't pick this up in time. No money moved — it's safe to try again.",
    );
  }

  if (
    (mapped.kind === 'anchor' && mapped.code === 3012) ||
    mapped.name === 'AccountNotInitialized' ||
    mapped.name === 'InvoiceNotFoundError' ||
    /invoice not found/i.test(lower)
  ) {
    return result('failed', 'INVOICE_CLOSED', 'This invoice was closed by the merchant. No money moved.');
  }

  if (
    (mapped.kind === 'wallet' && mapped.name === 'WalletNotConnectedError') ||
    /connect a wallet first|no wallet is connected|walletnotconnected/i.test(lower)
  ) {
    return result('failed', 'WALLET_NOT_CONNECTED', 'Connect your wallet to continue.');
  }

  if (
    mapped.name === 'WalletModifiedTransactionError' ||
    /wallet (changed|modified)|modified the transaction/i.test(lower)
  ) {
    return result(
      'failed',
      'WALLET_MODIFIED',
      'Your wallet changed the transaction, so we stopped it. Nothing was sent.',
    );
  }

  if (mapped.name === 'MainnetRefusedError' || /mainnet|refuses to run against/i.test(lower)) {
    return result('failed', 'MAINNET_REFUSED', 'Paytruth only runs on devnet.');
  }

  if (mapped.kind === 'token' || (mapped.name === 'InsufficientFunds' && /token|usdc/i.test(lower))) {
    return result('failed', 'INSUFFICIENT_USDC', 'Not enough USDC in your wallet.');
  }

  if (hasInsufficientContext) {
    return result('failed', 'INSUFFICIENT_SOL', 'Not enough SOL to pay the network fee.');
  }

  const mappedProgram =
    mapped.kind === 'program' && mapped.code !== undefined && mapped.code >= 6000 && mapped.code <= 6021
      ? lookupProgramError(mapped.code)
      : null;
  const programError =
    mappedProgram ??
    (mapped.kind === 'program' && mapped.code === 6022
      ? {
          code: 6022,
          name: 'InvoiceMismatch',
          message: 'The invoice changed since you loaded it; reload and try again.',
        }
      : extractProgramError(text));
  if (programError) {
    return result('failed', programError.name, programError.message);
  }

  if (hasProgramErrorContext) {
    const code = text.match(/0x[0-9a-fA-F]+/)?.[0];
    return result(
      'failed',
      'PROGRAM_ERROR',
      code ? `Simulation failed (program error ${code}).` : 'Simulation failed. Check the program logs.',
    );
  }

  return result('failed', 'UNKNOWN', 'Transaction failed. Try again.');
}
