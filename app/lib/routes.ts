'use client';

import { parsePublicKey } from '@/components/ui/sdk/validate';
import { PublicKey } from '@solana/web3.js';
import { useSearchParams } from 'next/navigation';

export const BASE_PATH = '/paytruth';

export type InvoiceRoute = 'pay' | 'verify' | 'merchant';

/** App-relative path (no basePath). Next <Link> and router prepend basePath. */
export function invoicePath(kind: InvoiceRoute, pda: string): string {
  return `/${kind}/?invoice=${encodeURIComponent(pda)}`;
}

/** Absolute site path including basePath, for CopyLink and Playwright. */
export function invoicePublicPath(kind: InvoiceRoute, pda: string): string {
  return `${BASE_PATH}${invoicePath(kind, pda)}`;
}

export function withBasePath(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith(BASE_PATH + '/') || path === BASE_PATH) return path;
  const [pathname, search] = path.split('?');
  const prefixed = `${BASE_PATH}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  return search !== undefined ? `${prefixed}?${search}` : prefixed;
}

export function useInvoiceParam(): PublicKey | null {
  const search = useSearchParams();
  return parsePublicKey(search.get('invoice') ?? '');
}

export function useInvoiceRawParam(): string {
  const search = useSearchParams();
  return search.get('invoice') ?? '';
}
