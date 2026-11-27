import type { ReactNode } from 'react';

import { cn } from './utils';

type ExplorerLinkBase = {
  children?: ReactNode;
  className?: string;
};

export type ExplorerLinkProps = ExplorerLinkBase &
  (
    | { signature: string; address?: never }
    | { address: string; signature?: never }
  );

export function ExplorerLink({ children, className, ...target }: ExplorerLinkProps) {
  const signature = 'signature' in target ? target.signature : undefined;
  const address = 'address' in target ? target.address : undefined;
  const href = signature
    ? `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`
    : address
      ? `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`
      : '#';
  const label = signature
    ? 'View transaction on Solana Explorer (devnet)'
    : 'View address on Solana Explorer (devnet)';

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-xs border border-[var(--accent)] px-2 text-small font-semibold text-accent transition-colors duration-fast hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {children ?? 'Open in Explorer'}
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M4 2h6v6M10 2L2 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}
