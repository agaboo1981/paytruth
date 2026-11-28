'use client';

import { useWallet } from '@solana/wallet-adapter-react';

import { Address } from '../address';
import { Button } from '../button';
import { cn } from '../utils';

export type ConnectedChipProps = {
  address?: string;
  onDisconnect?: () => void;
  className?: string;
};

export function ConnectedChip({ address, onDisconnect, className }: ConnectedChipProps) {
  const { connected, publicKey, disconnect } = useWallet();
  const resolvedAddress = address ?? (connected && publicKey ? publicKey.toBase58() : null);

  if (!resolvedAddress) return null;

  return (
    <div
      className={cn(
        'inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border bg-[var(--surface-2)] px-3 py-2',
        className,
      )}
    >
      <span className="w-full text-micro font-semibold text-success xl:w-auto">Connected</span>
      <Address address={resolvedAddress} />
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (onDisconnect) onDisconnect();
          else void disconnect();
        }}
      >
        Disconnect
      </Button>
    </div>
  );
}
