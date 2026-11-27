// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
// Constants
export {
  CONFIG_SEED,
  INVOICE_SEED,
  USDC_DECIMALS,
  MEMO_LEN,
  DEVNET_USDC_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  MAINNET_BETA_GENESIS_HASH,
} from './constants';

// Types
export type { Commitment, Config, Invoice, PaytruthSdk } from './types';
export { InvoiceStatus } from './types';

// IDL
export { PAYTRUTH_IDL, IDL_SOURCE, type PaytruthIdl } from './idl';

// Errors
export {
  PAYTRUTH_ERRORS,
  PaytruthError,
  MemoTooLongError,
  InvoiceNotFoundError,
  InvoiceAccountMismatchError,
  WalletModifiedTransactionError,
  WalletNotSupportedError,
  TxTimeoutError,
  MainnetRefusedError,
  mapError,
  type MappedError,
  type PaytruthErrorName,
} from './errors';

// Memo
export { encodeMemo, decodeMemo } from './memo';

// PDA
export { getConfigPda, getInvoicePda, getEscrowAta } from './pda';

// Program
export { resolveProgramId, getProgram, PLACEHOLDER_PROGRAM_ID } from './program';

// Accounts / decoding
export {
  decodeConfig,
  decodeInvoice,
  fetchConfig,
  fetchInvoice,
  fetchInvoiceOrNull,
  fetchInvoiceByMerchantAndId,
  fetchEscrowBalance,
  CONFIG_ACCOUNT_SIZE,
  INVOICE_ACCOUNT_SIZE,
} from './accounts';

// Instruction builders
export {
  buildInitializeConfigIx,
  buildCreateInvoiceIx,
  buildPayInvoiceIx,
  buildMerchantClaimIx,
  buildRefundOverpaymentIx,
  buildExpireInvoiceIx,
  buildRecoverUnattributedIx,
  buildCloseInvoiceIx,
} from './instructions';

// State machine
export {
  excessOf,
  isExcessCleared,
  isTerminal,
  canPay,
  canExpire,
  canClaim,
  canRefund,
  canRecover,
  canClose,
  expectedRejection,
  deriveInvoiceView,
  type PaytruthAction,
  type InvoicePhase,
  type InvoiceBadge,
  type InvoiceActions,
  type InvoiceView,
} from './state';

// Send path
export {
  signAndSend,
  verifySignedTransaction,
  confirmBySignatureStatus,
  type PaytruthWallet,
  type SendAttempt,
  type SignAndSendOptions,
  type ConfirmBySignatureStatusOptions,
  type WriteStage,
  type WriteStageInfo,
  type WriteOptions,
} from './send';

// Client
export { PaytruthClient, assertNotMainnet, type PaytruthClientOptions, type WriteResult } from './client';

// Bound singleton
export {
  bindPaytruth,
  getBoundClient,
  paytruthSdk,
  resolveRpcEndpoint,
  type BindPaytruthArgs,
} from './bound';
// Indexer (read-only)
export { parseTransaction, type ParsedPaytruthTx, type ParsedInstruction, type ParsedEvent } from './indexer/parseTransaction';
export {
  classifyPaymentAttempt,
  summarizeInvoicePayments,
  type PaymentClass,
  type InvoicePaymentSummary,
  type ChainStatus,
} from './indexer/classify';
export { watchInvoiceSignatures, type WatchInvoiceOptions } from './indexer/watcher';
