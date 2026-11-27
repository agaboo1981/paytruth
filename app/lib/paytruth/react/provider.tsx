'use client';
// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { type ReactNode, useMemo } from 'react';
import { MainnetRefusedError } from '../errors';
import { PaytruthBridge } from './hooks';

export interface PaytruthWalletProviderProps {
  children: ReactNode;
  /** RPC endpoint. Defaults to NEXT_PUBLIC_SOLANA_RPC or devnet. */
  endpoint?: string;
  autoConnect?: boolean;
}

function resolveEndpoint(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const env =
    typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_SOLANA_RPC : undefined;
  if (env && env.trim().length > 0) return env.trim();
  return clusterApiUrl('devnet');
}

function assertNotMainnetEndpoint(endpoint: string): void {
  if (endpoint.toLowerCase().includes('mainnet')) {
    throw new MainnetRefusedError(`Refusing to use a mainnet endpoint: ${endpoint}`);
  }
}

/**
 * Wraps the app in a Solana connection + wallet standard providers + the wallet
 * modal. `wallets` is left empty so Wallet Standard wallets (Phantom, Solflare,
 * Backpack) are auto-detected. Refuses mainnet endpoints.
 */
export function PaytruthWalletProvider({
  children,
  endpoint,
  autoConnect = true,
}: PaytruthWalletProviderProps): JSX.Element {
  const resolved = useMemo(() => resolveEndpoint(endpoint), [endpoint]);
  assertNotMainnetEndpoint(resolved);
  return (
    <ConnectionProvider endpoint={resolved}>
      <WalletProvider wallets={[]} autoConnect={autoConnect}>
        <PaytruthBridge />
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
