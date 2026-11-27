// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.

export const PaytruthErrorCode = {
  Underpayment: 6000,
  DuplicatePayment: 6001,
  InvoiceNotOpen: 6002,
  InvoiceExpired: 6003,
  InvoiceNotPaid: 6004,
  AlreadyClaimed: 6005,
  AlreadyRefunded: 6006,
  NothingToRefund: 6007,
  NotExpired: 6008,
  InvalidAmount: 6009,
  InvalidExpiry: 6010,
  InvalidMint: 6011,
  InvalidEscrow: 6012,
  UnauthorizedMerchant: 6013,
  InvalidPayerAta: 6014,
  Overflow: 6015,
  VaultNotEmpty: 6016,
  InvoiceNotTerminal: 6017,
  ExcessOutstanding: 6018,
  NothingToRecover: 6019,
  PayerNotRecorded: 6020,
  ConfigMintMismatch: 6021,
  InvoiceMismatch: 6022
};

export type PaytruthErrorName = keyof typeof PaytruthErrorCode;
