'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '../button';
import { cn } from '../utils';

export function CopyLink({
  path,
  label = 'Copy link',
  className,
}: {
  path: string;
  label?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const field = document.createElement('textarea');
        field.value = url;
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
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 2000);
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Button variant="secondary" size="sm" onClick={copy}>
        {label}
      </Button>
      <span className="text-small font-semibold text-success" aria-live="polite">
        {status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : ''}
      </span>
    </span>
  );
}
