# @paytruth/sdk

TypeScript client SDK for the **Paytruth** on-chain USDC invoice program
(Anchor 1.2.2). Wallet-to-wallet USDC invoices where the chain is the single
source of truth for settlement. The frontend reads RPC directly — no backend
ever declares a payment successful.

This package is `private` and is consumed by the Paytruth app. The public API
mirrors `docs/INTERFACES.md`; `PaytruthClient` structurally implements the
`PaytruthSdk` interface (also re-defined in `src/types.ts`).

## Modules

| Path | Responsibility |
|---|---|
| `src/constants.ts` | Seeds, `USDC_DECIMALS`, `MEMO_LEN`, devnet USDC mint, token program ids, mainnet genesis hash |
| `src/types.ts` | `Commitment`, `InvoiceStatus`, `Config`, `Invoice`, `PaytruthSdk` |
| `src/pda.ts` | `getConfigPda`, `getInvoicePda` (LE u64 seed), `getEscrowAta` |
| `src/memo.ts` | `encodeMemo` (zero-pad to 64, throw if longer), `decodeMemo` |
| `src/errors.ts` | `PAYTRUTH_ERRORS` (6000-6022), `mapError`, typed error classes |
| `src/accounts.ts` | `decodeConfig`/`decodeInvoice` (BN -> bigint), safe `fetchInvoice`, `fetchInvoiceOrNull`, `fetchEscrowBalance` |
| `src/instructions.ts` | Pure instruction builders, one per instruction, via `Program.methods.<camel>().accountsStrict({...}).instruction()` |
| `src/state.ts` | Pure state-machine predicates + `deriveInvoiceView` + `expectedRejection` |
| `src/send.ts` | `signAndSend` (wallet `signTransaction` only) + `verifySignedTransaction` byte check |
| `src/client.ts` | `PaytruthClient` with idempotent recovery, `waitForInvoiceState`, `subscribeInvoice`, cluster guard |
| `src/program.ts` | `resolveProgramId`, read-only `Program<Paytruth>` construction, typed `methods` accessor |
| `src/idl/` | The **only** module that imports the real Anchor IDL JSON; generated `Paytruth` type helper and error-code map |
| `src/indexer/` | Read-only transaction parser, payment classifier, invoice watcher |
| `src/react/` | `PaytruthWalletProvider`, `usePaytruthClient`, `useInvoice` (exported from `@paytruth/sdk/react`) |

## IDL: real Anchor IDL

The SDK now ships the real Anchor IDL from PR #2 (commit `4252df8`) at
`src/idl/paytruth.json`, with the generated type helper `src/idl/paytruth.ts`
(`export type Paytruth`) and numeric error map `src/idl/paytruth_errors.ts`.
`IDL_SOURCE` in `src/idl/index.ts` is `'anchor-4252df8'`, and the one-line swap
has already been made there:

```ts
import idl from './paytruth.json';
```

Every other module imports from `src/idl`; none import the JSON directly. The
old `paytruth.spec.json`, `scripts/gen-spec-idl.ts`, and `gen:idl` script were
removed. All discriminators are the first 8 bytes of SHA-256 of `"global:<ix>"`, `"account:<Name>"` or `"event:<Name>"` (tested).

The files in `src/idl/` are byte-identical copies of the Anchor Engineer's committed `target/idl/paytruth.json`, `target/types/paytruth.ts` and `target/types/paytruth_errors.ts` (main `237152f`). `pnpm sync:idl` re-copies them after a program change; `pnpm check:idl` (and the `idl-sync` unit test) fail if the copy is stale.

### Program id

The IDL address is the local scaffold program id
`D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H` (from `Anchor.toml`; **not a
devnet deployment**). The actual program id is resolved at runtime by
`resolveProgramId(override?)`:
`override ?? process.env.NEXT_PUBLIC_PAYTRUTH_PROGRAM_ID ?? PAYTRUTH_IDL.address`.

## IDL vs docs differences

These are the differences between the real Anchor IDL and the hand-written spec
fixture / `docs/*.md`; they are now reflected in the SDK:

- `pay_invoice` has a second argument `expected_amount_due: u64` after `amount`.
  Callers must supply it from the Invoice account they actually observed; the
  SDK never fetches or fills it silently. Stale terms produce `InvoiceMismatch`.
- In `pay_invoice`, `payer` is `signer: true, writable: null`. The transaction
  fee payer is still writable at the transaction level; the IDL account meta
  deliberately is not.
- `refund_overpayment` adds a read-only `payer` account immediately after
  `escrow`.
- Error `6022 InvoiceMismatch` was added: "The invoice changed since you loaded
  it; reload and try again." It is non-retryable without a reload.
- The `InvoiceExpired` type was added and the `events` array is alphabetically
  ordered; the event set itself is unchanged.
- The accounts and instruction names/discriminators are otherwise unchanged.
  Invoice account size remains 219 bytes (see "Spec discrepancy" below); escrow
  is `init_if_needed`, so a missing escrow ATA reads as a zero balance.
- `close_invoice` leaves the Invoice account as a `Closed` (status `3`) tombstone
  with `id` never reusable and closes the escrow ATA. `recover_unattributed` is
  still allowed on `Closed` if the escrow balance is greater than zero. A direct
  `pay_invoice` after close fails `AccountNotInitialized` while the escrow ATA is
  gone; if that ATA is recreated, the program's `DuplicatePayment` guard applies.

## Send path: sign, verify bytes, send raw

`signAndSend` builds a legacy `Transaction` (fee payer = wallet, recent
blockhash), calls **only** `wallet.signTransaction` (never the wallet's
`sendTransaction`), then `verifySignedTransaction` checks the returned bytes:

- fee payer unchanged;
- the recent blockhash **may change** (wallets refresh it); that is accepted;
- ComputeBudget instructions may be **added, removed or changed**, but only the
  allowlisted kinds — `SetComputeUnitLimit` (`data[0] == 2`, length 5) and
  `SetComputeUnitPrice` (`data[0] == 3`, length 9) — with **zero** account keys
  and at most one of each. Any other ComputeBudget instruction (e.g.
  `RequestHeapFrame = 1`, `SetLoadedAccountsDataSizeLimit = 4`, unknown, wrong
  length, or carrying account keys) throws `WalletModifiedTransactionError`;
- after removing the allowlisted ComputeBudget instructions from **both** sides,
  the remaining instructions must be **exactly equal**: same count, same order,
  each identical in `programId`, `data` bytes and ordered account metas
  (`pubkey`, `isSigner`, `isWritable`). Any added/missing/reordered/changed
  instruction — including an extra `SystemProgram` transfer or a prepended
  `AdvanceNonceAccount` — throws;
- the required signer set (fee payer + all `isSigner` keys) must be unchanged
  (no added or removed signers), `verifySignatures()` must be true, and every
  required signer must have a non-empty signature;
- as defence in depth, the compiled signed message may not make any account
  writable that is not writable in the compiled expected message.

The `signed`/`onSigned` callbacks receive the **real transaction signature**
(bs58 of the fee payer signature), not the wallet public key.

Only then does it `sendRawTransaction` and confirm. If the wallet kept our
blockhash it uses `confirmTransaction({ signature, blockhash, lastValidBlockHeight })`
at `confirmed`. If the wallet changed it, our `lastValidBlockHeight` no longer
applies; `confirmBySignatureStatus` instead polls
`getSignatureStatuses([sig])` (`searchTransactionHistory: false`) every ~500ms
until the status reaches the requested commitment, throws on an on-chain `err`,
gives up with a retryable error once `isBlockhashValid(signedBlockhash,
{ commitment: 'processed' })` reports false, or after a bounded timeout
(default 90s, overridable via `SignAndSendOptions.confirmTimeoutMs`).

## Idempotent writes (TEST-PLAN D1-D3)

`PaytruthClient.writeWithRecovery` sends at `confirmed`. `signAndSend` records
the signature and the blockhash the wallet **actually signed** into an optional
`attempt` object before the send. On send timeout / blockhash-exceeded / network
error, recovery **refetches the Invoice account** at `confirmed` then
`finalized`. If the `landed` predicate holds, it returns `{ recovered: true }`
without resubmitting. Only when the chain shows it did not land **and** the
signed blockhash has expired does it rebuild + re-sign + resend once. Expiry is
decided against the signed blockhash: if the wallet kept ours, compare
`getBlockHeight('confirmed') > lastValidBlockHeight`; otherwise it asks
`isBlockhashValid(signedBlockhash, { commitment: 'confirmed' })` (an RPC error is
treated as *not* expired). It never resubmits while the signed blockhash may
still be valid. `waitForInvoiceState` polls the **account** (not the signature)
at the requested commitment and throws `TxTimeoutError` on timeout.


## Cluster guard

The `PaytruthClient` constructor throws `MainnetRefusedError` if
`connection.rpcEndpoint` contains `mainnet`. `assertNotMainnetGenesis` checks
`getGenesisHash()` against the mainnet-beta genesis hash. The React provider
also refuses mainnet endpoints. Localnet/devnet only — no mainnet.

## Read-only indexer rule

```
indexer never declares success; status always comes from the Invoice account
```

`src/indexer/` parses transactions and classifies payment attempts, but
`chainStatus` in `summarizeInvoicePayments` is derived **only** from the fetched
`Invoice` account. If a successful pay tx is observed but the account at the
commitment is not `Paid`, `chainStatus` stays `unpaid` and a `discrepancy` is
reported. It never writes.

## Tests

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run (unit; no network, Connection mocked)
pnpm build       # tsup -> dist/ (ESM + CJS + .d.ts) for "." and "./react"
```

No network access in unit tests; `Connection` is mocked. Indexer fixtures in
`tests/fixtures/tx/` are **synthetic** (see that directory's README).

### Localnet E2E (gated, skipped by default)

`tests/localnet/e2e.test.ts` spawns and tears down its own
`solana-test-validator` and runs the seven TEST-PLAN §E steps against the real
program at `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H`:

```bash
solana-test-validator --reset --quiet \
  --ledger ./sdk/.test-ledger \
  --bpf-program D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H \
  <PAYTRUTH_PROGRAM_SO or ./.localnet-program.so> \
  --rpc-port 8899
PAYTRUTH_LOCALNET=1 pnpm test:localnet
```

`PAYTRUTH_PROGRAM_SO` defaults to `./sdk/.localnet-program.so`; the ledger is
`./sdk/.test-ledger` (both gitignored). The test waits for `getHealth`, waits for
the cluster clock to pass `expires_at = now + 4s`, and uses generous 120s
timeouts. It creates a fresh 6-decimal classic SPL mint and does exactly one
airdrop per keypair (no loops). If the validator cannot start, the test reports
the exact validator error and remains gated by `PAYTRUTH_LOCALNET=1`.

Synthetic transaction fixtures in `tests/fixtures/tx/` are generated from the
real IDL by `pnpm gen:fixtures` and include `failed-invoice-mismatch`.

## Devnet demo runner

`sdk/scripts/devnet/demo.ts` drives the seven TEST-PLAN §E demo steps against
the **deployed devnet program** with real signatures (no mocked success). It
sends nothing in `--check` mode. It refuses any mainnet URL and aborts unless
the cluster genesis hash is devnet (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`).
Pure logic lives in `sdk/scripts/devnet/lib.ts` and is unit-tested with a mocked
`Connection` (`tests/unit/devnet-runner.test.ts`).

It never reads or prints secret key bytes — only public keys. It never sends a
transaction during unit tests; the runner only touches the network when you run
it yourself.

### Configuration (no hardcoded ids)

| Env var | Purpose |
|---|---|
| `PAYTRUTH_DEVNET_RPC` | RPC endpoint; default `https://api.devnet.solana.com`. **Refused if it contains `mainnet`.** |
| `PAYTRUTH_PROGRAM_ID` | Override the program id (else parsed from `programs/DEPLOYMENTS.md`). |
| `PAYTRUTH_CONFIG_PDA` | Override the config PDA (else parsed from `DEPLOYMENTS.md`). |
| `PAYTRUTH_USDC_MINT` | Override the USDC mint (else parsed from `DEPLOYMENTS.md`). |
| `PAYTRUTH_MERCHANT_KEYPAIR` | Path to the merchant `solana-keygen` JSON. **No default.** |
| `PAYTRUTH_PAYER_KEYPAIR` | Path to the payer `solana-keygen` JSON. **No default.** |
| `STEP2_DUE` | Step 2 amount due, USDC base units (6 decimals). Default `1000000` (1.00). |
| `STEP5_DUE` | Step 5 amount due. Default `1000000`. |
| `STEP5_PAY` | Step 5 paid amount (overpay). Default `1500000` (1.50). |
| `STEP6_DUE` | Step 6 amount due. Default `1000000`. |

Program id / config PDA / USDC mint default to the `devnet` row of
`programs/DEPLOYMENTS.md`, resolved at runtime relative to the script's own
location. Keypair paths that resolve **inside the git repo** are refused.

### Sanity checks (before any step)

Program account exists and is executable; `getConfigPda(programId) ==` the
recorded config PDA; on-chain `Config.usdc_mint ==` the mint; the mint account
is owned by the classic SPL Token program with decimals `6`. Any mismatch aborts
with a clear message.

### Commands

```bash
pnpm devnet:check                       # = tsx scripts/devnet/demo.ts --check
pnpm devnet:demo                        # = tsx scripts/devnet/demo.ts
pnpm devnet:demo -- --step 5            # run only step 5
pnpm devnet:demo -- --from 4            # run steps 4..7
pnpm devnet:demo -- --wait-usdc 600     # poll payer USDC every 10s up to 600s
```

`--check` sends no transactions. It prints the resolved program/config/mint, the
sanity results, and a table of role / pubkey / SOL / USDC / required SOL /
required USDC / OK or NEEDS FUNDING. It **exits 0 even when funding is missing**
(and says so). Use it to decide how much to fund before a live run.

`--wait-usdc SEC` applies before each step that needs USDC (2, 4, 5, 6): if the
payer's balance is short, the runner polls every 10s up to `SEC` seconds, then
aborts with the exact amount needed if it never arrives.

### Funding needs

- **USDC (payer peak):** `STEP2_DUE + STEP5_PAY` = **2.50 USDC** by default.
  Step 4 (duplicate) and step 6 (expired) are rejected by the program *before*
  any transfer, so they need no extra USDC — only the payer's ATA must exist.
  The merchant needs **0 USDC**.
- **SOL:** merchant **>= 0.05 SOL**, payer **>= 0.01 SOL** (rent for the invoice
  and escrow ATAs, the merchant ATA, and fees).

### What each step asserts

1. Merchant creates invoice A (`STEP2_DUE`, expires in 1h) → **Open** on-chain, escrow ATA exists with balance 0.
2. Payer pays A exact (`expectedAmountDue` from the fetched invoice) → **Paid**, `paid_amount == due`, payer recorded, escrow balance `== due`.
3. Merchant claims A → **claimed** (waits for **finalized**), merchant USDC increased by `due`, escrow 0.
4. Payer attempts a duplicate payment via `buildPayInvoiceIx` sent with `sendRawTransaction({ skipPreflight: true })` so the failure is **recorded on-chain**; read back with `getTransaction` and assert `meta.err` maps to **DuplicatePayment**; invoice state and payer balance unchanged.
5. New invoice B (`STEP5_DUE`); payer pays `STEP5_PAY` → **Paid** with excess; `refundOverpayment` (permissionless; payer is the caller) → `refunded_excess == excess` and payer balance `== before - STEP5_DUE`; merchant claims B so B is clean.
6. New invoice C expiring in 30s; wait until cluster block time passes `expires_at`; payer pay with `skipPreflight: true` fails on-chain (**InvoiceExpired** via `getTransaction` + `mapError`); `expireInvoice` → **Expired**; merchant `closeInvoice` → **Closed** (account remains, escrow ATA closed).
7. An independent `PaytruthClient` with **no wallet** fetches A, B, C (status, amounts, claimed, refundedExcess) and escrow balances at **finalized**, and prints the `/verify/<invoicePda>` paths.

Every transaction is recorded (step, label, signature, explorer link, ok /
expected-failure-with-error-name) into `sdk/.devnet-runs/<ISO>.json` and
`<ISO>.md` (gitignored). The summary prints times in Africa/Lagos (WAT). The
runner exits non-zero if any assertion fails.

## Spec discrepancy

`docs/PROGRAM-SPEC.md` states the Invoice `InitSpace` is `203` (formula
`96 + 40 + 3 + 64`) and the account size is `8 + 203 = 211`. But the same
document's field table lists **six** integer fields (`invoice_id`, `amount_due`,
`paid_amount`, `refunded_excess`, `created_at`, `expires_at` = 48 bytes, not 40).
The true layout is therefore:

- Invoice **data** = `96 + 48 + 3 + 64` = **211 bytes**
- Invoice **account** = `8 (discriminator) + 211` = **219 bytes**
- Config account = `8 + 65` = **73 bytes**

Per team decision (option 1) we keep **all** listed fields (they are also in
`docs/INTERFACES.md`). Exported constants: `INVOICE_ACCOUNT_SIZE = 219`,
`CONFIG_ACCOUNT_SIZE = 73`. `fetchInvoice` validates the account data length is
exactly 219. The real Anchor IDL confirms this layout.

## App integration (`app/lib/paytruth`)

The Next.js app consumes a generated mirror of `sdk/src/**` at
`app/lib/paytruth/**`. Generate/refresh it from `sdk/` with:

```bash
pnpm sync:app          # mirror sdk/src -> app/lib/paytruth (deletes stale files)
pnpm check:app-sync    # non-zero exit if the mirror is stale (CI)
```

Each `.ts`/`.tsx` copy starts with
`// GENERATED from sdk/src by \`pnpm sync:app\` — do not edit here.` (placed
after a leading `'use client'` directive, which stays first). JSON is copied
as-is. The app must declare these runtime deps: `@anchor-lang/core@^1.2.2`,
`@solana/spl-token@^0.4.15`, `bn.js` (plus the existing
`@solana/web3.js@1.99.0`, `react@18.3.1`, wallet-adapter packages).

### UI wiring (verified 27 Nov on a scratch copy of feat/ui 1054010)

Applied to a throwaway worktree of `feat/ui`: `tsc --noEmit` exit 0, `next build` succeeded (all 8 routes), UI vitest 50/50. The full diff is in [`sdk/ui-wiring.patch`](./ui-wiring.patch) (`git apply sdk/ui-wiring.patch` from the repo root on feat/ui). The changes:

1. `app/components/ui/sdk/real-sdk.ts` → `export { paytruthSdk as realSdk } from '@/lib/paytruth';`
2. `app/components/ui/sdk/types.ts` → `export { InvoiceStatus, type Commitment, type Config, type Invoice, type PaytruthSdk } from '@/lib/paytruth';` (the UI's own enum lacks `Closed = 3`, so the types must come from the SDK or tsc fails).
3. `app/components/ui/sdk/use-invoice-view.ts` → `export function useInvoiceView(pda: PublicKey | null): InvoiceView { return useInvoice(pda, { client: sdk }); }` (passing the UI's `sdk` keeps `NEXT_PUBLIC_PAYTRUTH_SDK=mock` working).
4. `app/app/layout.tsx` → `import { PaytruthWalletProvider } from '@/lib/paytruth/react';` and wrap `<ToastProvider>…</ToastProvider>` in `<PaytruthWalletProvider>` at the marked integration point.
5. `app/app/pay/[invoicePda]/page.tsx` → `sdk.payInvoice({ invoicePda, amount, expectedAmountDue: view.invoice.amountDue })` (required by the program; mismatch is `InvoiceMismatch` 6022).
6. `app/next.config.mjs` → add `webpack: (config) => { config.resolve.fallback = { ...config.resolve.fallback, fs: false }; return config; }`. `@anchor-lang/core` 1.2.2's browser bundle has a `require("fs")` inside `NodeWallet.local()` (never called in the browser); without this `next build` fails with "Can't resolve 'fs'".
7. `app/package.json` → add `"@anchor-lang/core": "1.2.2"`, `"@solana/spl-token": "0.4.15"`, `"bn.js": "^5.2.1"` (dev: `"@types/bn.js"`).

## Bound singleton (`paytruthSdk`)

`bindPaytruth({ connection?, wallet?, programId? })` (re)creates a singleton
`PaytruthClient`; `getBoundClient()` returns it; `paytruthSdk` is a stable
`PaytruthSdk` object delegating to the current bound client. The
`<PaytruthWalletProvider>` renders an inner `<PaytruthBridge/>` that calls
`bindPaytruth` whenever the connection/wallet change (wallet attached only when
connected and it exposes `signTransaction`). Before any bind, reads use
`new Connection(resolveRpcEndpoint(), 'confirmed')` where
`resolveRpcEndpoint()` = `NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl('devnet')`
(with mainnet refusal). Writes with no wallet throw a `PaytruthError` with the
friendly message `Connect a wallet first.`.

## Write-stage callbacks

Every write method accepts an optional `opts?: WriteOptions` (backward
compatible; `PaytruthSdk` is unchanged):

```ts
interface WriteOptions {
  onStage?: (stage: 'awaiting-signature' | 'signed' | 'sent' | 'confirmed', info?: { signature?: string }) => void;
  onSigned?: (signature: string) => void;
}
```

Order on success: `awaiting-signature` (before `wallet.signTransaction`),
`signed` + `onSigned(feePayerBase58)` (after the byte check passes), `sent`
(after `sendRawTransaction`), `confirmed` (after confirmation). A recovered
(already-landed) result fires `confirmed`. On a recovery resubmit the sequence
repeats for the new transaction. Callback exceptions are caught and ignored.

## Decisions

Conservative readings recorded for any ambiguity:

- **Size**: see "Spec discrepancy" above — true sizes 219 / 73 are used.
- **`expectedRejection`**: encodes the PROGRAM-SPEC precondition order, plus the
  real-IDL `InvoiceMismatch` check. `pay` first rejects non-terminal status, then
  `expectedAmountDue !== amount_due` with `InvoiceMismatch`, then expiry. The
  caller-supplied `amount > 0` / `amount >= amountDue` checks are validated by
  builders/caller, not invoice state, so they are not part of `expectedRejection`.
  Every action on `Closed` is rejected (`close` gives `InvoiceNotTerminal`).
- **`excessOf`** is `paid_amount - amount_due` floored at `0`.
- **Expected escrow holdings** for `unattributed`: Open `0`; Paid
  `(claimed ? 0 : amount_due) + max(0, excess - refunded_excess)`; Expired `0`;
  Closed `0` (but `recover_unattributed` is allowed if the real balance is > 0).
- **`awaiting_expiry`**: an Open invoice past `expires_at` (not yet expired
  on-chain) shows badge `UNPAID`, phase `awaiting_expiry`, `pay` disabled,
  `expire` enabled.
- **`confirming`**: `commitment !== "finalized"` while the phase is `paid` /
  badge `CLAIMED`.
- **Invoice PDA ordering**: LE u64 seed, validated `0 <= id < 2^64`.
- **Refund/claim write `landed` predicates**: refund = `refunded_excess > 0`;
  claim = `claimed`; expire = status `Expired`; close = fetched account still
  exists with status `Closed` (the escrow ATA is gone, not the Invoice); recover =
  escrow balance `0`.
- **Indexer classification**: a successful `pay_invoice` after another success is
  `double-pay`; a failed `pay_invoice` with `DuplicatePayment` is `double-pay`;
  `InvoiceMismatch` / `InvoiceExpired` / other failed `pay_invoice` are `failed`;
  any other program tx is `not-a-payment`; missing tx is `pending`. `chainStatus`
  is `'closed'` for a `Closed` Invoice account.
- **Wallet without `signTransaction`**: `PaytruthBridge` leaves the wallet
  unbound, so reads still work and writes throw `Connect a wallet first.`;
  callers can use the exported `assertWalletSupportsSigning` for an explicit
  `WalletNotSupportedError`. The SDK never falls back to the wallet's
  `sendTransaction`.
- **`"use client"`**: directives live in the React source files. esbuild strips
  module directives while bundling, so `scripts/fix-use-client.mjs` (run from
  tsup `onSuccess`) re-prepends `'use client';` as the first line of
  `dist/react/index.js` and `dist/react/index.cjs` so Next.js client components
  resolve correctly. The esbuild "directive ignored" warning during build is
  benign.
- **Byte check also pins `recentBlockhash`**: the wallet must not change it,
  because `confirmTransaction` uses our `lastValidBlockHeight`. A changed
  blockhash throws `WalletModifiedTransactionError`.
- **`signed` signature value**: the stage carries the fee payer's base58 public
  key (the wallet publicKey); `onSigned` receives the same value. (The raw
  transaction signature over the message is not known until after `sendRawTransaction`
  returns the network signature, which is reported at `sent`/`confirmed`.)
- **`paytruthSdk` write signatures stay `PaytruthSdk`**: the bound singleton’s
  write methods take only the interface arg (no `opts`); use a
  `PaytruthClient` directly when you need write-stage callbacks.
- **`useInvoice` `finalized`**: true only when the `finalized` account matches
  the `confirmed` account on `status`, `claimed`, `paidAmount`,
  `refundedExcess`; otherwise the confirmed account is shown and a re-check is
  scheduled after 2s. A subscription push sets `finalized=false` and triggers a
  refetch. A `null` push (account truly removed) sets `invoice=null`,
  `errorKind='not-found'`; a `Closed` tombstone is still a fetched Invoice with
  phase `closed` / badge `CLOSED` and no available actions. `errorKind` maps
  `InvoiceNotFoundError` (or any message containing "not found") to `not-found`,
  anything else to `unavailable`.
- **IDL import is a plain JSON import** (`import idl from './paytruth.json'`)
  so Next 14 SWC can compile it; it remains the single swap point.
- **`app/lib/paytruth` mirror**: generated verbatim from `sdk/src/**` with the
  generated-marker comment (after a leading `'use client'`). JSON (including the
  real `paytruth.json`) is copied as-is. Stale files are deleted; `.gitkeep` and
  `README.md` are preserved.

## Real-IDL decisions

- **`payInvoice` requires `expectedAmountDue: bigint`** at the client, bound
  singleton, and `PaytruthSdk` interface; it is encoded as the second u64 in the
  instruction data. The SDK fetches the Invoice only to discover `mint` and
  never uses the fetched `amount_due` as the expected value.
- **Recoverability**: stale terms are `InvoiceMismatch` (non-retryable until the
  payer reloads); `InvoiceExpired` is a real-IDL error but is still reported as
  expired, not a client-side timeout. `mapError` uses the real IDL message table
  (6000-6022).
- **Program typing**: `getProgram()` returns `Program<Paytruth>` using the
  generated type helper so instruction names and arguments are checked at type
  time; the runtime IDL remains the one imported in `src/idl`.
- **Mapped-error round trip**: `mapError` returns an already-mapped error carried
  by `mapToPaytruthError` unchanged, so program names/codes survive the
  `signAndSend` → `writeWithRecovery` → caller path. Localnet confirmed
  `DuplicatePayment` / `InvoiceExpired` surface by name.
- **Post-close duplicate**: localnet confirmed the escrow ATA is truly gone after
  `close_invoice`; the first pay attempt therefore fails `AccountNotInitialized`.
  Recreating the ATA reveals the tombstone's `DuplicatePayment` guard (step 6).
- **Default RPC when unbound**: `NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl('devnet')`;
  a mainnet endpoint is refused with `MainnetRefusedError`.

