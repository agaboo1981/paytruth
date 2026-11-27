'use client';

import { useConnection, useWallet, type Wallet } from '@solana/wallet-adapter-react';

import { Badge } from '../badge';
import { cn } from '../utils';

function isDevnetEndpoint(endpoint: string): boolean {
  return /devnet/i.test(endpoint);
}

type StateProps = {
  detected?: string;
  className?: string;
};

type ChainsFeature = { chains?: unknown };
type StandardWalletLike = {
  standard?: unknown;
  wallet?: { features?: Record<string, unknown> };
};

export function readWalletCluster(wallet: Wallet | null): string | undefined {
  const adapter = wallet?.adapter;
  if (!adapter) return undefined;

  const standard = adapter as unknown as StandardWalletLike;
  if (standard.standard !== true) return undefined;

  const feature = standard.wallet?.features?.['solana:chains'];
  if (typeof feature !== 'object' || feature === null) return undefined;

  const chains = (feature as ChainsFeature).chains;
  if (!Array.isArray(chains) || typeof chains[0] !== 'string') return undefined;

  return chains[0].split(':')[1];
}

export function NoWalletState({ className }: StateProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-border bg-[var(--surface-2)] p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-border text-pending" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18">
            <rect x="2" y="4" width="14" height="10" rx="2" fill="none" stroke="currentColor" />
            <path d="M2 7h14" stroke="currentColor" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="font-display text-title font-bold text-fg">No wallet detected</p>
          <p className="mt-1 text-small text-muted">
            Install a Wallet Standard wallet such as Phantom or Solflare, then reload this page.
            Nothing opens or connects automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

export function WrongNetworkState({ detected, className }: StateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-[var(--warning)] bg-[var(--surface-2)] p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="warning">Network check</Badge>
        <p className="font-display text-title font-bold text-warning">
          This app uses Solana devnet only.
        </p>
      </div>
      <p className="mt-2 break-all text-small text-muted">
        {detected ? `Detected: ${detected}. Switch the wallet or RPC endpoint to devnet.` : 'Switch the wallet or RPC endpoint to devnet.'}
      </p>
    </div>
  );
}

export function NoWalletGuard({ className }: StateProps) {
  const { wallets } = useWallet();
  if (wallets.length > 0) return null;
  return <NoWalletState className={className} />;
}

export function WalletNetworkGuard({ className }: StateProps) {
  const { connection } = useConnection();
  const { wallet } = useWallet();
  const walletCluster = readWalletCluster(wallet);

  if (isDevnetEndpoint(connection.rpcEndpoint) && (!walletCluster || walletCluster === 'devnet')) {
    return null;
  }

  const detected = !isDevnetEndpoint(connection.rpcEndpoint)
    ? connection.rpcEndpoint
    : walletCluster
      ? `solana:${walletCluster}`
      : undefined;

  return <WrongNetworkState detected={detected} className={className} />;
}
