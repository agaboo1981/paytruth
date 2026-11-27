'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from './utils';

export type AddressProps = {
  address: string;
  chars?: number;
  className?: string;
};

export function Address({ address, chars = 4, className }: AddressProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const truncated =
    address.length <= chars * 2 + 3
      ? address
      : `${address.slice(0, chars)}...${address.slice(-chars)}`;

  async function copyAddress() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        const field = document.createElement('textarea');
        field.value = address;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('Copy failed');
      }
      setStatus('copied');
    } catch {
      setStatus('error');
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setStatus('idle'), 1800);
  }

  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-2', className)}
      aria-label={`Solana address ${address}`}
      title={address}
    >
      <span className="truncate font-mono text-small tabular-nums text-fg">{truncated}</span>
      <button
        type="button"
        onClick={copyAddress}
        aria-label={`Copy address ${address}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-border text-muted transition-colors duration-fast hover:border-[var(--accent)] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5" y="5" width="8" height="8" rx="1" fill="none" stroke="currentColor" />
          <path d="M11 3H3v8" fill="none" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </button>
      <span className="text-micro font-semibold text-muted" aria-live="polite">
        {status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : ''}
      </span>
    </span>
  );
}
