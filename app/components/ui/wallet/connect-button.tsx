'use client';

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

import { cn } from '../utils';

export function ConnectButton({ className }: { className?: string }) {
  return <WalletMultiButton className={cn('kit-wallet-button', className)} />;
}
