'use client';

import type { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

import { isMock } from './client';
import { MOCK_WALLET } from './fixtures';

export type UseWalletKeyResult = {
  publicKey: PublicKey | null;
  connected: boolean;
};

function useMockWalletKey(): UseWalletKeyResult {
  return { publicKey: MOCK_WALLET, connected: true };
}

function useRealWalletKey(): UseWalletKeyResult {
  const { publicKey, connected } = useWallet();
  return { publicKey: publicKey ?? null, connected: connected && Boolean(publicKey) };
}

/**
 * Mock mode reports the fixed demo wallet as connected so the UI can run
 * without a provider. Real mode follows the wallet adapter, which is only
 * mounted when isMock is false. The choice is made once at module load, so the
 * hook order never changes between renders.
 */
export const useWalletKey: () => UseWalletKeyResult = isMock
  ? useMockWalletKey
  : useRealWalletKey;
