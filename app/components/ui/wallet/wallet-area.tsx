'use client';

import { useWallet } from '@solana/wallet-adapter-react';

import { MOCK_WALLET } from '../sdk/fixtures';
import { isMock } from '../sdk/client';
import { ConnectedChip } from './connected-chip';
import { ConnectButton } from './connect-button';

export function WalletArea() {
  if (isMock) {
    return (
      <span
        className="inline-flex min-h-10 items-center gap-2 rounded-pill border border-[var(--border)] bg-[var(--surface-2)] px-3 text-small font-semibold text-fg"
        title={MOCK_WALLET.toBase58()}
      >
        <span className="h-1.5 w-1.5 rounded-pill bg-[var(--success)]" aria-hidden="true" />
        Demo wallet
      </span>
    );
  }
  return <RealWalletArea />;
}

function RealWalletArea() {
  const { connected, publicKey } = useWallet();
  if (connected && publicKey) return <ConnectedChip />;
  return <ConnectButton />;
}
