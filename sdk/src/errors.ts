import { AnchorError, ProgramError } from '@anchor-lang/core';
import { SendTransactionError } from '@solana/web3.js';

export type PaytruthErrorName =
  | 'Underpayment'
  | 'DuplicatePayment'
  | 'InvoiceNotOpen'
  | 'InvoiceExpired'
  | 'InvoiceNotPaid'
  | 'AlreadyClaimed'
  | 'AlreadyRefunded'
  | 'NothingToRefund'
  | 'NotExpired'
  | 'InvalidAmount'
  | 'InvalidExpiry'
  | 'InvalidMint'
  | 'InvalidEscrow'
  | 'UnauthorizedMerchant'
  | 'InvalidPayerAta'
  | 'Overflow'
  | 'VaultNotEmpty'
  | 'InvoiceNotTerminal'
  | 'ExcessOutstanding'
  | 'NothingToRecover'
  | 'PayerNotRecorded'
  | 'ConfigMintMismatch'
  | 'InvoiceMismatch';

export interface PaytruthErrorEntry {
  code: number;
  name: PaytruthErrorName;
  message: string;
}

const rawErrors: { code: number; name: PaytruthErrorName; message: string }[] = [
  { code: 6000, name: 'Underpayment', message: 'The payment is less than the invoice amount due.' },
  { code: 6001, name: 'DuplicatePayment', message: 'This invoice is already paid or no longer open.' },
  { code: 6002, name: 'InvoiceNotOpen', message: 'This invoice is not open.' },
  { code: 6003, name: 'InvoiceExpired', message: 'This invoice has expired.' },
  { code: 6004, name: 'InvoiceNotPaid', message: 'This invoice has not been paid yet.' },
  { code: 6005, name: 'AlreadyClaimed', message: 'These funds have already been claimed.' },
  { code: 6006, name: 'AlreadyRefunded', message: 'The overpayment has already been refunded.' },
  { code: 6007, name: 'NothingToRefund', message: 'There is no overpayment to refund.' },
  { code: 6008, name: 'NotExpired', message: 'This invoice has not reached its expiry time yet.' },
  { code: 6009, name: 'InvalidAmount', message: 'The amount must be greater than zero.' },
  { code: 6010, name: 'InvalidExpiry', message: 'The expiry must be in the future.' },
  { code: 6011, name: 'InvalidMint', message: 'The token mint is not the supported USDC mint.' },
  { code: 6012, name: 'InvalidEscrow', message: 'The escrow account is not valid for this invoice.' },
  { code: 6013, name: 'UnauthorizedMerchant', message: 'Only the invoice merchant can do this.' },
  { code: 6014, name: 'InvalidPayerAta', message: 'The token account is not owned by the expected party.' },
  { code: 6015, name: 'Overflow', message: 'An arithmetic overflow occurred.' },
  { code: 6016, name: 'VaultNotEmpty', message: 'The escrow still holds funds and cannot be closed.' },
  { code: 6017, name: 'InvoiceNotTerminal', message: 'This invoice is not in a terminal state.' },
  { code: 6018, name: 'ExcessOutstanding', message: 'The overpayment must be refunded first.' },
  { code: 6019, name: 'NothingToRecover', message: 'There are no funds to recover.' },
  { code: 6020, name: 'PayerNotRecorded', message: 'This invoice has no recorded payer.' },
  { code: 6021, name: 'ConfigMintMismatch', message: 'The mint does not match the configured USDC mint.' },
  {
    code: 6022,
    name: 'InvoiceMismatch',
    message: 'The invoice changed since you loaded it; reload and try again.',
  },
];

export const PAYTRUTH_ERRORS: Record<number, PaytruthErrorEntry> = Object.fromEntries(
  rawErrors.map((e) => [e.code, e]),
);

const NAME_BY_CODE = new Map<number, PaytruthErrorName>(rawErrors.map((e) => [e.code, e.name]));
const CODE_BY_NAME = new Map<PaytruthErrorName, number>(rawErrors.map((e) => [e.name, e.code]));

/** Common Anchor framework errors we surface by name (2000-3999). */
const ANCHOR_CODES: Record<number, string> = {
  2000: 'ConstraintMut',
  2001: 'ConstraintHasOne',
  2002: 'ConstraintSigner',
  2003: 'ConstraintRaw',
  2004: 'ConstraintOwner',
  2005: 'ConstraintRentExempt',
  2006: 'ConstraintSeeds',
  2007: 'ConstraintExecutable',
  2008: 'ConstraintState',
  2009: 'ConstraintAssociated',
  2010: 'ConstraintAssociatedInit',
  2011: 'ConstraintClose',
  2012: 'ConstraintAddress',
  2013: 'ConstraintZero',
  2014: 'ConstraintTokenMint',
  2015: 'ConstraintTokenOwner',
  2016: 'ConstraintMintMintAuthority',
  2017: 'ConstraintMintFreezeAuthority',
  2018: 'ConstraintMintDecimals',
  2019: 'ConstraintSpace',
  2020: 'ConstraintAccountIsNone',
  2021: 'ConstraintTokenMint?',
  2500: 'RequireViolated',
  2501: 'RequireEqViolated',
  2502: 'RequireKeysEqViolated',
  2503: 'RequireNeqViolated',
  2504: 'RequireKeysNeqViolated',
  2505: 'RequireGtViolated',
  2506: 'RequireGteViolated',
  3000: 'AccountDiscriminatorAlreadySet',
  3001: 'AccountDiscriminatorNotFound',
  3002: 'AccountDiscriminatorMismatch',
  3003: 'AccountDidNotDeserialize',
  3004: 'AccountDidNotSerialize',
  3005: 'AccountNotEnoughKeys',
  3006: 'AccountNotMutable',
  3007: 'AccountOwnedByWrongProgram',
  3008: 'InvalidProgramId',
  3009: 'InvalidProgramExecutable',
  3010: 'AccountNotSigner',
  3011: 'AccountNotSystemOwned',
  3012: 'AccountNotInitialized',
  3013: 'AccountNotProgramData',
  3014: 'AccountNotAssociatedTokenAccount',
  3015: 'AccountSysvarMismatch',
  3016: 'AccountReallocExceedsLimit',
  3017: 'AccountDuplicateReallocs',
  4100: 'DeclaredProgramIdMismatch',
  5000: 'TryingToInitPayerAsProgramAccount',
};

export type MappedErrorKind = 'program' | 'anchor' | 'wallet' | 'rpc' | 'token' | 'unknown';

export interface MappedError {
  kind: MappedErrorKind;
  code?: number;
  name?: string;
  message: string;
  retryable: boolean;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Typed error classes
// ---------------------------------------------------------------------------

export class PaytruthError extends Error {
  override name = 'PaytruthError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MemoTooLongError extends PaytruthError {
  override name = 'MemoTooLongError';
  constructor(public readonly actualLength: number, public readonly maxLength: number) {
    super(`Memo is ${actualLength} bytes; the maximum is ${maxLength} bytes.`);
  }
}

export class InvoiceNotFoundError extends PaytruthError {
  override name = 'InvoiceNotFoundError';
  constructor(public readonly invoicePda: string) {
    super(`Invoice not found: no invoice account exists at ${invoicePda}.`);
  }
}

export class InvoiceAccountMismatchError extends PaytruthError {
  override name = 'InvoiceAccountMismatchError';
  constructor(message: string) {
    super(message);
  }
}

export class WalletModifiedTransactionError extends PaytruthError {
  override name = 'WalletModifiedTransactionError';
  constructor(message = 'The wallet modified the transaction in a way that is not allowed.') {
    super(message);
  }
}

export class WalletNotSupportedError extends PaytruthError {
  override name = 'WalletNotSupportedError';
  constructor(message = 'This wallet does not support transaction signing.') {
    super(message);
  }
}

export class TxTimeoutError extends PaytruthError {
  override name = 'TxTimeoutError';
  constructor(message = 'Timed out waiting for the transaction to reach the expected state.') {
    super(message);
  }
}

export class MainnetRefusedError extends PaytruthError {
  override name = 'MainnetRefusedError';
  constructor(message = 'Paytruth refuses to run against mainnet-beta.') {
    super(message);
  }
}

const FEE_PAYER_UNFUNDED_MESSAGE =
  'This wallet needs a little SOL to pay network fees. Fund it with SOL and try again.';
const INVOICE_CLOSED_MESSAGE = 'This invoice is closed and can no longer be paid.';

/** The fee-paying wallet has no SOL (unfunded / never-credited account). */
export class FeePayerUnfundedError extends PaytruthError {
  override name = 'FeePayerUnfundedError';
  readonly mapped: MappedError;
  constructor(options?: { cause?: unknown }) {
    super(FEE_PAYER_UNFUNDED_MESSAGE, options);
    this.mapped = {
      kind: 'rpc',
      name: 'FeePayerUnfunded',
      message: FEE_PAYER_UNFUNDED_MESSAGE,
      retryable: false,
      raw: options?.cause ?? this,
    };
  }
}

/** Payment attempted on a Closed (tombstoned) invoice. Never "already paid". */
export class InvoiceClosedError extends PaytruthError {
  override name = 'InvoiceClosedError';
  readonly mapped: MappedError;
  constructor(public readonly invoicePda: string, options?: { cause?: unknown }) {
    super(INVOICE_CLOSED_MESSAGE, options);
    this.mapped = {
      kind: 'program',
      name: 'InvoiceClosed',
      message: INVOICE_CLOSED_MESSAGE,
      retryable: false,
      raw: options?.cause ?? this,
    };
  }
}

/** Payment attempted on an expired invoice (detected client-side or disambiguated). */
export class InvoiceExpiredError extends PaytruthError {
  override name = 'InvoiceExpiredError';
  readonly mapped: MappedError;
  constructor(public readonly invoicePda: string, options?: { cause?: unknown }) {
    const message = PAYTRUTH_ERRORS[6003]?.message ?? 'This invoice has expired.';
    super(message, options);
    this.mapped = {
      kind: 'program',
      code: 6003,
      name: 'InvoiceExpired',
      message,
      retryable: false,
      raw: options?.cause ?? this,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function programMessage(code: number): string {
  const entry = PAYTRUTH_ERRORS[code];
  return entry ? entry.message : `Program error ${code}.`;
}

function extractLogs(err: unknown): string[] {
  const obj = err as { logs?: unknown; transactionLogs?: unknown } | null;
  if (obj) {
    if (Array.isArray(obj.transactionLogs)) return obj.transactionLogs as string[];
    if (Array.isArray(obj.logs)) return obj.logs as string[];
  }
  if (err instanceof Error && typeof err.message === 'string') {
    return err.message.split('\n');
  }
  return [];
}

function parseCodeFromText(text: string): { code: number; name?: string } | null {
  const anchor = /Error Code:\s*([A-Za-z0-9_]+)\.\s*Error Number:\s*(\d+)/.exec(text);
  if (anchor) return { code: Number(anchor[2]), name: anchor[1] };
  const hex = /custom program error:\s*0x([0-9a-fA-F]+)/.exec(text);
  if (hex) return { code: parseInt(hex[1]!, 16) };
  const dec = /custom program error:\s*(\d+)/.exec(text);
  if (dec) return { code: Number(dec[1]) };
  return null;
}

function findInstructionError(err: unknown): { index: number; custom?: number; system?: string } | null {
  let node: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && node && typeof node === 'object'; depth++) {
    if (seen.has(node)) break;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    const ie = obj.InstructionError ?? (obj.err as Record<string, unknown> | undefined)?.InstructionError;
    if (Array.isArray(ie) && ie.length === 2) {
      const idx = Number(ie[0]);
      const detail = ie[1];
      if (detail && typeof detail === 'object' && 'Custom' in (detail as object)) {
        return { index: idx, custom: Number((detail as { Custom: number }).Custom) };
      }
      if (typeof detail === 'string') return { index: idx, system: detail };
      if (detail && typeof detail === 'object') {
        return { index: idx, system: Object.keys(detail as object)[0] };
      }
      return { index: idx };
    }
    node = obj.cause ?? (obj.err as unknown) ?? obj.error;
  }
  return null;
}

function walletName(err: unknown): string | null {
  const obj = err as { name?: unknown } | null;
  if (!obj || typeof obj.name !== 'string') return null;
  const known = [
    'WalletNotConnectedError',
    'WalletSignTransactionError',
    'WalletSendTransactionError',
    'WalletTimeoutError',
    'WalletWindowClosedError',
    'WalletConnectionError',
    'WalletSignMessageError',
    'WalletDisconnectedError',
  ];
  if (known.includes(obj.name)) return obj.name;
  return null;
}

function textOf(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const obj = err as { message?: unknown };
    if (typeof obj.message === 'string') return obj.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// mapError
// ---------------------------------------------------------------------------

export function mapError(err: unknown): MappedError {
  const raw = err;

  const alreadyMapped = (err as { mapped?: unknown } | null)?.mapped;
  if (alreadyMapped && typeof alreadyMapped === 'object' && 'kind' in alreadyMapped && 'message' in alreadyMapped) {
    return alreadyMapped as MappedError;
  }

  // SendTransactionError: look at logs for the real cause first.
  if (err instanceof SendTransactionError) {
    const logs = extractLogs(err);
    const joined = logs.join('\n');
    const fromLogs = parseCodeFromText(joined);
    const tokenInsuff = /Token(keg|zQd)[A-Za-z0-9]*[^\n]*failed: custom program error: 0x1/.test(joined);
    if (fromLogs) {
      const m = classifyCode(fromLogs.code, fromLogs.name, raw);
      if (tokenInsuff && m.code === 1) return inkMapped(token(raw));
      return m;
    }
    if (tokenInsuff) return inkMapped(token(raw));
    const t = textOf(err);
    const fromText = parseCodeFromText(t);
    if (fromText) return classifyCode(fromText.code, fromText.name, raw);
    return mapError(t || new Error(t));
  }

  // Typed AnchorError
  if (err instanceof AnchorError) {
    const ec = err.error.errorCode as unknown as {
      code?: string;
      name?: string;
      codeNumber?: number;
      number?: number;
    };
    const code = ec.codeNumber ?? ec.number ?? 0;
    const name = ec.code ?? ec.name;
    return classifyCode(code, name, raw);
  }

  // ProgramError carries a numeric code
  if (err instanceof ProgramError) {
    const code = (err as unknown as { code: number }).code;
    if (typeof code === 'number') return classifyCode(code, undefined, raw);
  }

  // A structured InstructionError object somewhere in the chain.
  const ie = findInstructionError(err);
  if (ie && ie.custom !== undefined) {
    if (ie.custom === 1) {
      const logs = extractLogs(err);
      if (logs.some((l) => /Token(keg|zQd)/.test(l))) return inkMapped(token(raw));
    }
    return classifyCode(ie.custom, undefined, raw);
  }
  if (ie && ie.system) {
    return mapSystem(ie.system, raw);
  }

  // Wallet-adapter error names.
  const wName = walletName(err);
  if (wName) {
    return {
      kind: 'wallet',
      name: wName,
      message: walletMessage(wName),
      retryable: false,
      raw,
    };
  }

  const text = textOf(err);
  if (text.length === 0) {
    return { kind: 'unknown', message: 'Unknown error.', retryable: false, raw };
  }

  // Unfunded fee payer (RPC simulation / TransactionError InvalidAccountForFee).
  if (/may not be used to pay transaction fees|InvalidAccountForFee/i.test(text)) {
    return feePayerUnfunded(raw);
  }

  // System "already in use".
  if (/already in use/i.test(text) && /(Allocate|account)/i.test(text)) {
    return {
      kind: 'anchor',
      message: 'An invoice with this ID already exists. Choose a different invoice ID.',
      retryable: false,
      raw,
    };
  }

  // Log-line / hex code embedded in text.
  const parsed = parseCodeFromText(text);
  if (parsed) {
    const tokenInsuff = /Token(keg|zQd)[A-Za-z0-9]*[^\n]*custom program error: 0x1/.test(text);
    if (tokenInsuff && parsed.code === 1) return inkMapped(token(raw));
    return classifyCode(parsed.code, parsed.name, raw);
  }


  // SPL token insufficient funds noise (no structured code available).
  if (/insufficient funds|insufficientfunds/i.test(text)) {
    return inkMapped(token(raw));
  }

  // Need SOL for fees.
  if (/attempt to debit an account but found no record of a prior credit/i.test(text)) {
    return feePayerUnfunded(raw);
  }

  // RPC retryables.
  if (/blockhash not found|block ?height exceeded|blockhash.*expired/i.test(text)) {
    return {
      kind: 'rpc',
      message: 'The transaction blockhash expired before it landed. It can be retried.',
      retryable: true,
      raw,
    };
  }
  if (/429|too many requests|rate limit/i.test(text)) {
    return {
      kind: 'rpc',
      message: 'The RPC node is rate limiting requests. Try again shortly.',
      retryable: true,
      raw,
    };
  }
  if (/timeout|timed out|etimedout|econnreset|network/i.test(text)) {
    return {
      kind: 'rpc',
      message: 'The RPC request failed (network or timeout). It can be retried.',
      retryable: true,
      raw,
    };
  }

  return { kind: 'unknown', message: text, retryable: false, raw };
}

function feePayerUnfunded(raw: unknown): MappedError {
  return { kind: 'rpc', name: 'FeePayerUnfunded', message: FEE_PAYER_UNFUNDED_MESSAGE, retryable: false, raw };
}

function token(raw: unknown): MappedError {
  return {
    kind: 'token',
    code: 1,
    name: 'InsufficientFunds',
    message: 'Not enough USDC in the wallet to complete this payment.',
    retryable: false,
    raw,
  };
}

function inkMapped(m: MappedError): MappedError {
  return m;
}

function classifyCode(code: number, name: string | undefined, raw: unknown): MappedError {
  if (code >= 6000 && code <= 6022) {
    const resolved = NAME_BY_CODE.get(code) ?? name ?? 'Underpayment';
    return {
      kind: 'program',
      code,
      name: resolved,
      message: programMessage(code),
      retryable: false,
      raw,
    };
  }
  if (code >= 2000 && code <= 3999) {
    const resolved = name ?? ANCHOR_CODES[code] ?? 'AnchorError';
    return {
      kind: 'anchor',
      code,
      name: resolved,
      message: `Anchor constraint error (${resolved}).`,
      retryable: false,
      raw,
    };
  }
  if (code === 0) {
    return { kind: 'unknown', code, message: 'The transaction failed.', retryable: false, raw };
  }
  return {
    kind: 'unknown',
    code,
    name,
    message: `Program error ${code}.`,
    retryable: false,
    raw,
  };
}

function mapSystem(system: string, raw: unknown): MappedError {
  if (/already in use/i.test(system)) {
    return {
      kind: 'anchor',
      message: 'An invoice with this ID already exists. Choose a different invoice ID.',
      retryable: false,
      raw,
    };
  }
  return { kind: 'unknown', name: system, message: system, retryable: false, raw };
}

function walletMessage(name: string): string {
  switch (name) {
    case 'WalletNotConnectedError':
      return 'No wallet is connected.';
    case 'WalletSignTransactionError':
      return 'The transaction signature was rejected or cancelled.';
    case 'WalletSendTransactionError':
      return 'The wallet failed to send the transaction.';
    case 'WalletTimeoutError':
      return 'The wallet did not respond in time.';
    case 'WalletWindowClosedError':
      return 'The wallet window was closed before signing.';
    case 'WalletConnectionError':
      return 'The wallet connection failed.';
    case 'WalletDisconnectedError':
      return 'The wallet was disconnected during the operation.';
    default:
      return 'A wallet error occurred.';
  }
}
