// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
import { PublicKey } from '@solana/web3.js';

export const CONFIG_SEED = 'config';
export const INVOICE_SEED = 'invoice';
export const USDC_DECIMALS = 6;
export const MEMO_LEN = 64;

/** Circle USDC mint on devnet (6 decimals, classic SPL Token). */
export const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

/** Classic SPL Token program id. */
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** Token-2022 program id. Paytruth rejects Token-2022 mints. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/** The mainnet-beta genesis hash, used by the cluster guard. */
export const MAINNET_BETA_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
