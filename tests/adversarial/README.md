# Adversarial tests

Defensive rejection tests only. They assert that each attack fails with the expected Anchor error (or a safe balance/state invariant) and that rejected transactions leave invoice fields and token balances unchanged. They are not exploit scripts.

## Status

**These tests have not been compiled or run. They must not be reported as passing.**

The suite is not runnable until:

1. The Paytruth program and IDL have landed (`initializeConfig`, `createInvoice`, `payInvoice`, and the other six instructions on `program.methods`).
2. Dependencies below are installed in the Anchor workspace (`paytruth/package.json`).
3. The suite is run on a **fresh local validator**. It calls `initialize_config` itself and will refuse to start if the Config PDA already exists (do not share a validator with `tests/program` that already initialized Config).

Until the Paytruth instructions exist, a `before` hook calls `this.skip()` so the existing counter smoke test in `tests/program/paytruth.ts` is not broken. Skip reason: Paytruth instructions are not on the program yet.

Authoring: drafted via `opencode run -m opencode/big-pickle`, then corrected by the QA and Security Lead (runtime skip, mint funding, `transferChecked` argument order, PDA ATA `allowOwnerOffCurve`).

## Needed dependencies

- `@anchor-lang/core` (already in `package.json`; provides `web3`, `BN`, and token address helpers)
- `@solana/spl-token` (needed later; classic Token program only) — not yet in `package.json`, and this suite must not add it. It is loaded lazily in `helpers.ts` so the counter smoke test is not broken when the dependency is missing.

Install with the repo's package manager when the suite is enabled:

```sh
pnpm add -D @solana/spl-token
```

No Circle or devnet mint is used. Each suite run creates a fresh 6-decimal legacy SPL mint, local ATAs, and mints test tokens to the merchant/payer/attacker wallets.

## Clock helper

`warpToUnixTimestamp(ts)` uses a bankrun, LiteSVM, or context warp hook when one is exposed by the provider/connection. Otherwise it falls back to creating short-lived invoices and waiting on wall-clock time. Because local validator slot timestamps advance in whole seconds, the fallback may land just after `expires_at` rather than exactly at `now == expires_at`; the boundary assertions still hold because pay requires `unix_timestamp < expires_at` and expire requires `unix_timestamp >= expires_at`.

## Scope

- `helpers.ts` — loose-typed setup, PDAs, ATAs, mint, balances, snapshots, error matching, clock, and instruction builders.
- `attacks.ts` — A1–A25 from `docs/TEST-PLAN.md` plus X1–X16 extra QA cases (expiry boundary, third-party refund destination, mint/escrow identity on outbound instructions, decoy vault close, Token-2022 on claim/refund/recover/close, escrow ATA pre-create, close-and-recreate underpayment, recover of stray funds, recover blocked while unclaimed).
- Spec holes these extra tests encode: `/workspace/solana-hackathon/qa/paytruth-spec-review.md` (S2, S3, M2, and the expiry/refund cases).

## Program contract this suite expects (PR head)

- `payInvoice(amount, expectedAmountDue)` — mismatch returns `InvoiceMismatch` (6022).
- `close_invoice` leaves a **Closed tombstone** (status = 3); the Invoice account is not deleted, so the same `invoice_id` can never be re-initialized.
- Anchor constraint errors (`ConstraintTokenOwner` 2015, `ConstraintTokenMint` 2014, `InvalidProgramId` 3008) are accepted alongside the named Paytruth errors when they fire first.
