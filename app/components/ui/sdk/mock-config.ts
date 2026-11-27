export const MOCK_PROGRAM_ID = '5npGxWjAex8ugJgNNoY9uBXkvnpieFtxiEJkQy593rAh';

export const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const STORAGE_KEY = 'paytruth-mock-v1';
const FAIL_KEY = 'paytruth-mock-fail';

export type FailMode = 'reject' | 'expire' | 'error';

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function resolveStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: StorageLike }).localStorage) {
      return (globalThis as { localStorage?: StorageLike }).localStorage as StorageLike;
    }
  } catch {
    return null;
  }
  return null;
}

export function readJson<T>(storage: StorageLike | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be full or unavailable in private mode */
  }
}

export function readFailMode(storage: StorageLike | null): FailMode | null {
  if (!storage) return null;
  const value = storage.getItem(FAIL_KEY);
  if (value === 'reject' || value === 'expire' || value === 'error') return value;
  return null;
}

export function clearFailMode(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(FAIL_KEY);
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function randomDelay(): Promise<void> {
  const ms = 900 + Math.floor(Math.random() * 701);
  return sleep(ms);
}

export { USDC_MINT as MOCK_USDC_MINT };
export { STORAGE_KEY, FAIL_KEY };
