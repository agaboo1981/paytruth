# Paytruth Architecture

Wallet-to-wallet USDC invoices on Solana. An Anchor program is the single source of truth for settlement. The frontend reads the chain directly. No backend may declare a payment successful.

Stack pins: **Anchor 1.2.2 + anchor-spl 1.2.2** (latest stable, published 2026-10-22). Source: https://www.anchor-lang.com/docs/tokens and the Anchor GitHub changelog for 1.2.2.

USDC (devnet): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals, classic SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). Source: https://developers.circle.com/stablecoins/usdc-contract-addresses. Mainnet mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` is documented for reference only and must not be used. Faucet: https://faucet.circle.com/ (20 USDC/address/chain per 2h).

## Components

| Component | Responsibility | Owns |
|---|---|---|
| Anchor program (`programs/paytruth`) | Custody escrow, state machine, all settlement transitions, events | Invoice/Config accounts, escrow ATA |
| TS client SDK (`sdk/**` or `app/lib/paytruth/**`) | PDA derivation, instruction assembly, reads, subscription, wait helpers | IDL wrapping, wallet adapter glue |
| Next.js frontend (App Router) | Merchant create, customer pay, verify page, merchant claim/refund/recover/close | UI, presentational verify route |
| Read-only indexer | **Not built in v1.** The frontend reads RPC directly. If added later it may only read accounts/events and never emits "paid". | — |
| Wallet adapter | Signer for merchant, payer, and permissionless callers | — |

At deploy (once per cluster) the Anchor Engineer calls `initialize_config` with the chosen mint (official Circle devnet USDC, or the fallback test mint). The mint must be classic SPL Token with 6 decimals. v1 cannot change `Config.usdc_mint` afterwards.

Prefer direct RPC reads for the hackathon: fewer moving parts, and the verify page must read the `Invoice` account (and escrow token balance) itself. A backend cannot "declare success" because the verify page never trusts one — it derives the Invoice PDA and reads `status`, `claimed`, `paid_amount`, `refunded_excess` from chain.

## Accounts

Two program-owned account types plus one standard escrow ATA.

| Account | Seeds | Size (bytes) | Notes |
|---|---|---|---|
| Config | `[b"config"]` | 73 | `8 (disc) + 65` |
| Invoice | `[b"invoice", merchant, invoice_id.to_le_bytes()]` | 219 | `8 (disc) + 211` |
| Escrow | ATA of (authority = Invoice PDA, mint = invoice.mint) | 165 | Standard SPL token account |

Config fields: `authority: Pubkey (32)`, `usdc_mint: Pubkey (32)`, `bump: u8 (1)` → 65 bytes.

Invoice fields: `merchant (32)`, `payer (32)`, `mint (32)`, `invoice_id (8)`, `amount_due (8)`, `paid_amount (8)`, `refunded_excess (8)`, `created_at (8)`, `expires_at (8)`, `status: u8 (1)`, `claimed: bool (1)`, `bump (1)`, `memo: [u8;64] (64)` → `96 + 48 + 3 + 64 = 211` bytes.

Field-by-field layout and validation: see [PROGRAM-SPEC.md](./PROGRAM-SPEC.md).

## Trust model

- Funds move only through the program. Escrow ATA authority is the Invoice PDA; only PDA-signed CPIs move tokens. The merchant cannot take more than `amount_due` via `merchant_claim`.
- Status and amounts are on-chain. The verify page reads them directly; nothing off-chain can flip a badge.
- Underpay is rejected (`Underpayment`), so `paid_amount` is always `>= amount_due` when Paid and merchant entitlement is always exactly `amount_due`.
- Overpay is `Paid` with `excess = paid_amount - amount_due`; the excess is refunded to the recorded payer via `refund_overpayment` (permissionless).

## Why the escrow design fixes the Round-4 finding

Round 4 objected that a non-custodial `settle` instruction was "not load-bearing": the merchant could self-declare payment without moving funds. Paytruth fixes this:

1. `pay_invoice` atomically moves USDC payer→escrow and sets `status = Paid` in the same instruction. There is no way to obtain Paid without funds in escrow.
2. `merchant_claim` sends `amount_due` escrow→merchant, capped at `amount_due`, once (`claimed` flag). Entitlement is enforced by the program, not by UI trust.
3. `status` lives on-chain and the verify page reads it directly. A backend cannot "declare success" in any way the verify page would honour.

## Data flows

### Merchant create
```
Merchant wallet ──create_invoice(invoice_id, amount_due, expires_at, memo)──▶ Program
  Program: init Invoice PDA (Open), init escrow ATA (authority = Invoice PDA)
  Emits: InvoiceCreated
```

### Customer pay (exact or over)
```
Payer wallet ──pay_invoice(amount)──▶ Program
  Checks: status==Open, now<expires_at, amount>=amount_due, amount>0, mint match, escrow is Invoice ATA
  CPI transfer_checked(amount) payer ATA → escrow
  Sets payer, paid_amount=amount, status=Paid
  Emits: InvoicePaid { amount, excess }
```

### Verify (independent observer)
```
Browser /verify/[invoicePda] ──read Invoice account + escrow ATA balance (RPC)──▶ chain
  Renders status, paid_amount, amount_due, excess, claimed, expiry. No backend call declares payment.
```

### Claim
```
Merchant ──merchant_claim()──▶ Program
  Requires status==Paid, claimed==false
  transfer_checked(amount_due) escrow → merchant ATA (init_if_needed); claimed=true
  Emits: InvoiceClaimed
```

### Refund overpayment
```
Any fee payer ──refund_overpayment()──▶ Program
  Requires status==Paid, paid_amount>amount_due, refunded_excess==0
  transfer_checked(excess) escrow → recorded payer ATA; refunded_excess=excess
  Emits: OverpaymentRefunded
```

### Expire
```
Any fee payer ──expire_invoice()──▶ Program
  Requires status==Open, now>=expires_at
  status=Expired; Emits: InvoiceExpired
  (later) merchant recover_unattributed / close_invoice when vault empty
```

## Limitations (known, intentional)

| Limitation | Consequence |
|---|---|
| Direct transfers / raw Solana Pay QR | A plain SPL transfer to the escrow or merchant wallet does NOT set Paid, record a payer, or raise `paid_amount`. Only `pay_invoice` counts. UI must expose an in-app transaction request, not a wallet-target transfer QR. |
| Unattributed funds | Stray tokens in the vault cannot be claimed (`merchant_claim` caps at `amount_due`) or refunded (`refund_overpayment` only refunds recorded excess). After terminal + excess cleared, merchant may `recover_unattributed` and must empty the vault before `close_invoice`. The program cannot attribute a raw transfer to its sender, so accidental transfers are recovered by the merchant, not the original sender. |
| No partial pay | Underpay rejected; no partial balances, top-ups, or pro-rata claims. |
| No Token-2022 | Only classic SPL Token USDC. Token-2022 lookalikes are rejected by token-program check. |
| Faucet limits | Circle faucet 20 USDC/address/chain per 2h. Fallback: a 6-decimal legacy-SPL devnet test mint recorded in `programs/DEPLOYMENTS.md`, set as `Config.usdc_mint`. Config is init-once; no mint change in v1. |
| Public RPC flakiness | Client submits `confirmed`, polls the Invoice account, then optionally waits `finalized`. On timeout, refetch before resubmitting; program rejects duplicates (`DuplicatePayment`). Blockhash expiry ~30s at 200ms slots. |
| Open invoices cannot be closed | An Open invoice has no attributed funds. Close only after Expired, or after Paid + claimed + excess cleared, and only when the vault is empty. |

## Commitment strategy

| Action | Commitment |
|---|---|
| Send | `confirmed` (snappy UX) |
| Poll after send | Invoice account at `confirmed`, then `finalized` |
| Public Paid/Claimed badge | prefer `finalized`; may show "confirming…" at `confirmed` |
| Merchant release-goods | wait `finalized` |

## File ownership / branches

| Owner | Files |
|---|---|
| Anchor Engineer | `programs/paytruth/**`, `tests/program/**`; commits `target/idl/paytruth.json`, `target/types/paytruth.ts`; updates `programs/DEPLOYMENTS.md` after deploy |
| Full-Stack Engineer | `sdk/**` (or `app/lib/paytruth/**`), wallet provider, hooks, read-only API/indexer routes (never a "mark paid" endpoint) |
| UI/UX Engineer | `app/components/ui/**`, `app/styles/**`, tailwind, presentational layouts, verify page chrome (consumes SDK/hooks) |
| QA/Security | `tests/adversarial/**`, `tests/e2e/**`, security write-up (no program logic change without PR review) |
| Team Lead | repo, branch protection, PR merges, README, submission, these docs |

Branches: `feat/program`, `feat/client`, `feat/ui`, `qa/tests`. `main` is protected; no direct or force pushes; only the Team Lead merges PRs.
