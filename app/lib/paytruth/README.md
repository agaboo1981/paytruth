# app/lib/paytruth (GENERATED)

This directory is **generated** from `sdk/src/**` by `pnpm sync:app` (run from `sdk/`).
Do not edit files here directly — edit `sdk/src/**` and re-run the sync.

The app must declare these runtime dependencies (they are the SDK's deps):

- `@anchor-lang/core@^1.2.2`
- `@solana/spl-token@^0.4.15`
- `bn.js`

Import from the app as:

```ts
import { paytruthSdk } from '@/lib/paytruth';
import { useInvoice, PaytruthWalletProvider } from '@/lib/paytruth/react';
```

Check that this mirror is up to date with `pnpm check:app-sync` (from `sdk/`).
