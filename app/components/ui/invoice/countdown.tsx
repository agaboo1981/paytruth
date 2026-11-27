'use client';

import { useEffect, useState } from 'react';

function relative(expiresAt: bigint, nowSec: number): string {
  const diff = Number(expiresAt) - nowSec;
  if (diff <= 0) return 'expired';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} hour${hours === 1 ? '' : 's'}` : ''}`;
  if (hours > 0) return `in ${hours} hour${hours === 1 ? '' : 's'}${minutes ? ` ${minutes} min` : ''}`;
  return `in ${Math.max(1, minutes)} min`;
}

export function Countdown({ expiresAt }: { expiresAt: bigint }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(id);
  }, []);

  const isExpired = Number(expiresAt) <= now;

  return (
    <span aria-live="off" className={isExpired ? 'text-danger' : 'text-fg'}>
      {relative(expiresAt, now)}
    </span>
  );
}
