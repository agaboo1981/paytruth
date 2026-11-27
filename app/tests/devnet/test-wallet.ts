/**
 * Headless Wallet Standard test wallet for devnet UI E2E.
 *
 * The secret key never enters the browser: the page asks Node to sign through
 * `page.exposeFunction`. Keypairs load from a directory OUTSIDE the repo
 * (PAYTRUTH_UI_E2E_KEYDIR, default ~/.config/paytruth-ui-e2e) and are never
 * printed. Devnet only.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { BrowserContext } from '@playwright/test';
import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';

export const WALLET_NAME = 'Paytruth Test Wallet';

export function keyDir(): string {
  return resolve(process.env.PAYTRUTH_UI_E2E_KEYDIR ?? join(homedir(), '.config', 'paytruth-ui-e2e'));
}

export function loadRole(role: 'merchant' | 'payer'): Keypair {
  const dir = keyDir();
  const repoRoot = resolve(__dirname, '..', '..', '..');
  if (dir.startsWith(repoRoot)) throw new Error('Refusing to load test keypairs from inside the repo.');
  const bytes = JSON.parse(readFileSync(join(dir, `${role}.json`), 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function signBytes(keypair: Keypair, b64: string): string {
  const raw = Buffer.from(b64, 'base64');
  // Versioned messages have the high bit set on the first message byte after signatures.
  try {
    const vtx = VersionedTransaction.deserialize(raw);
    if (vtx.version !== 'legacy') {
      vtx.sign([keypair]);
      return Buffer.from(vtx.serialize()).toString('base64');
    }
  } catch {
    /* fall through to legacy */
  }
  const tx = Transaction.from(raw);
  tx.partialSign(keypair);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

/** Install the wallet into every page of the context and make it auto-connect. */
export async function installTestWallet(context: BrowserContext, keypair: Keypair): Promise<void> {
  await context.exposeFunction('__paytruthTestSign', (b64: string) => signBytes(keypair, b64));
  const pubkey = Array.from(keypair.publicKey.toBytes());
  await context.addInitScript(
    ({ name, pubkey }) => {
      window.localStorage.setItem('walletName', JSON.stringify(name));
      const chains = ['solana:devnet'] as const;
      const features = ['solana:signTransaction'];
      const account = {
        address: '',
        publicKey: new Uint8Array(pubkey),
        chains,
        features,
      };
      // base58 encode for address
      const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let v = 0n;
      for (const b of account.publicKey) v = (v << 8n) | BigInt(b);
      let s = '';
      while (v > 0n) {
        s = A[Number(v % 58n)] + s;
        v /= 58n;
      }
      for (const b of account.publicKey) {
        if (b !== 0) break;
        s = '1' + s;
      }
      account.address = s;
      let connected = false;
      const listeners: Record<string, Array<(p: unknown) => void>> = {};
      const toB64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
      const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const wallet = {
        version: '1.0.0',
        name,
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=',
        chains,
        get accounts() {
          return connected ? [account] : [];
        },
        features: {
          'standard:connect': {
            version: '1.0.0',
            connect: async () => {
              connected = true;
              (listeners.change ?? []).forEach((l) => l({ accounts: [account] }));
              return { accounts: [account] };
            },
          },
          'standard:disconnect': {
            version: '1.0.0',
            disconnect: async () => {
              connected = false;
            },
          },
          'standard:events': {
            version: '1.0.0',
            on: (event: string, l: (p: unknown) => void) => {
              (listeners[event] ??= []).push(l);
              return () => {
                listeners[event] = (listeners[event] ?? []).filter((x) => x !== l);
              };
            },
          },
          'solana:signTransaction': {
            version: '1.0.0',
            supportedTransactionVersions: ['legacy', 0],
            signTransaction: async (...inputs: Array<{ transaction: Uint8Array }>) => {
              const out = [];
              for (const input of inputs) {
                const signed = await (window as unknown as { __paytruthTestSign: (b: string) => Promise<string> })
                  .__paytruthTestSign(toB64(input.transaction));
                out.push({ signedTransaction: fromB64(signed) });
              }
              return out;
            },
          },
        },
      };
      const register = ({ register }: { register: (w: unknown) => void }) => register(wallet);
      window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail));
      window.dispatchEvent(
        new CustomEvent('wallet-standard:register-wallet', { detail: register }),
      );
    },
    { name: WALLET_NAME, pubkey },
  );
}
