'use client';
// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.

import { createContext } from 'react';
import type { PaytruthSdk } from '../types';

/**
 * Optional explicit client for `useInvoice`/`usePaytruthClient` tests and for
 * apps that construct their own PaytruthClient. When absent, the hooks build a
 * client from useConnection + useWallet.
 */
export const PaytruthClientContext = createContext<PaytruthSdk | null>(null);
