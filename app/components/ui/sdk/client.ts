import { mockSdk } from './mock-sdk';
import { realSdk } from './real-sdk';
import type { PaytruthSdk } from './types';

export const SDK_MODE: 'mock' | 'real' =
  process.env.NEXT_PUBLIC_PAYTRUTH_SDK === 'mock' ? 'mock' : 'real';

export const isMock = SDK_MODE === 'mock';

export const sdk: PaytruthSdk = isMock ? mockSdk : realSdk;

export { mockSdk, realSdk };
export { MOCK_WALLET } from './fixtures';
