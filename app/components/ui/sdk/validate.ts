import { PublicKey } from '@solana/web3.js';

/** Returns the pubkey if the string is a valid 32-byte base58 address, else null. */
export function parsePublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value.trim());
  } catch {
    return null;
  }
}
