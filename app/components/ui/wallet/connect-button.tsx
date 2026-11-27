'use client';

import { useEffect, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

import { cn } from '../utils';

/**
 * WalletMultiButton reads the remembered wallet from localStorage on its first
 * client render (icon + label), which the server cannot know. Render a stable
 * placeholder until mount so hydration matches (React error #418 otherwise).
 */
export function ConnectButton({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button type="button" className={cn('wallet-adapter-button kit-wallet-button', className)} disabled aria-busy="true">
        Select Wallet
      </button>
    );
  }
  return <WalletMultiButton className={cn('kit-wallet-button', className)} />;
}
