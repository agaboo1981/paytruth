# Paytruth Program Spec

Anchor 1.2.2 + anchor-spl 1.2.2. Source: https://www.anchor-lang.com/docs/tokens and Anchor changelog 1.2.2 (published 2026-10-22).

USDC (devnet): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals, classic SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). Source: https://developers.circle.com/stablecoins/usdc-contract-addresses. Mainnet (reference only, do not use): `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.

## Constants

| Name | Value |
|---|---|
| `CONFIG_SEED` | `b"config"` |
| `INVOICE_SEED` | `b"invoice"` |
| `USDC_DECIMALS` | `6` |
| `MEMO_LEN` | `64` |

## Accounts

### Config — PDA `[b"config"]`

| Field | Type | Bytes |
|---|---|---|
| authority | Pubkey | 32 |
| usdc_mint | Pubkey | 32 |
| bump | u8 | 1 |
| **InitSpace** | | **65** |
| **Account size** | `8 + 65` | **73** |

`authority` is the initializer; no further admin role in v1. Config initialized once; `usdc_mint` immutable after init.

### Invoice — PDA `[b"invoice", merchant.key().as_ref(), invoice_id.to_le_bytes().as_ref()]`

| Field | Type | Bytes | Notes |
|---|---|---|---|
| merchant | Pubkey | 32 | invoice owner |
| payer | Pubkey | 32 | `Pubkey::default()` until first successful pay |
| mint | Pubkey | 32 | must equal `Config.usdc_mint` |
| invoice_id | u64 | 8 | merchant-chosen; unique per merchant (PDA `init` fails on collision) |
| amount_due | u64 | 8 | > 0 |
| paid_amount | u64 | 8 | 0 or `>= amount_due` when Paid |
| refunded_excess | u64 | 8 | 0 or exactly `paid_amount - amount_due` |
| created_at | i64 | 8 | `Clock.unix_timestamp` at create |
| expires_at | i64 | 8 | `> now` at create |
| status | u8 (InvoiceStatus) | 1 | Open=0, Paid=1, Expired=2 |
| claimed | bool | 1 | set true by `merchant_claim` |
| bump | u8 | 1 | Invoice PDA bump |
| memo | [u8;64] | 64 | UTF-8, zero-padded |
| **InitSpace** | | **203** | `96 + 40 + 3 + 64` |
| **Account size** | `8 + 203` | **211** | |

`payer` is a `Pubkey` (not `Option<Pubkey>`); default pubkey means unpaid.

### Escrow ATA

Standard 165-byte classic SPL token account for `(authority = Invoice PDA, mint = invoice.mint)`, created at `create_invoice` with `associated_token::authority = invoice`. No separate vault-authority PDA.

### InvoiceStatus

```
Open = 0, Paid = 1, Expired = 2
```

## Instructions

All monetary transfers use `transfer_checked` with decimals = `USDC_DECIMALS`. Outgoing transfers from escrow use `CpiContext::new_with_signer` with Invoice PDA seeds + stored `bump`. Token program arg must be the classic Token program; reject Token-2022.

`init_if_needed` is allowed ONLY on recipient ATAs (merchant claim destination, payer refund destination, recover destination), with `associated_token::mint` / `associated_token::authority` constraints and the fee payer as `payer`. Never use `init_if_needed` on the Invoice account itself (reinit attack). The Invoice account always uses `init`.

### 1. `initialize_config(usdc_mint: Pubkey)`

- Caller: `authority` signer.
- Accounts: `authority` (signer, payer), `config` (init, PDA `[b"config"]`), `usdc_mint` (owned by classic Token program, decimals == 6), `system_program`.
- Preconditions: mint owner is classic Token program and `decimals == 6` else `InvalidMint`.
- Writes: `authority = authority`, `usdc_mint = usdc_mint`, `bump = canonical`.
- Errors: a second call fails the Anchor `init` constraint (account already exists). Do not add a custom `ConfigAlreadyInitialized` code unless wrapping that failure.

### 2. `create_invoice(invoice_id: u64, amount_due: u64, expires_at: i64, memo: [u8;64])`

- Caller: `merchant` signer.
- Accounts: `merchant` (signer, payer), `config` (PDA `[b"config"]`), `invoice` (init, PDA), `mint` (== `config.usdc_mint`), `escrow` (init ATA, authority = invoice), `token_program` (classic), `associated_token_program`, `system_program`.
- Preconditions: `amount_due > 0` (`InvalidAmount`); `expires_at > Clock.unix_timestamp` (`InvalidExpiry`); `mint.key() == config.usdc_mint` (`ConfigMintMismatch`).
- Effects: `merchant`, `mint = config.usdc_mint`, `invoice_id`, `amount_due`, `created_at = now`, `expires_at`, `status = Open`, `payer = default`, `paid_amount = 0`, `refunded_excess = 0`, `claimed = false`, `bump = canonical`, `memo` zero-padded to 64.
- Event: `InvoiceCreated { invoice, merchant, invoice_id, amount_due, expires_at }`.

### 3. `pay_invoice(amount: u64)`

- Caller: `payer` signer.
- Accounts: `payer` (signer), `config`, `invoice` (mut, PDA), `mint` (== invoice.mint), `payer_ata` (authority = payer), `escrow` (mut, == Invoice ATA), `token_program` (classic).
- Preconditions (in order): `status == Open` else `DuplicatePayment`; `Clock.unix_timestamp < expires_at` else `InvoiceExpired`; `amount > 0` else `InvalidAmount`; `amount >= amount_due` else `Underpayment`; `mint.key() == invoice.mint` and `invoice.mint == config.usdc_mint` else `InvalidMint` / `ConfigMintMismatch`; `escrow.key() == get_associated_token_address(&invoice.key(), &mint.key())` and token authority == invoice else `InvalidEscrow`; `payer_ata` authority == payer else `InvalidPayerAta`. (If status is Open, `invoice.payer` is always default; a defensive `invoice.payer == default || invoice.payer == payer` check may be kept but is unreachable after the Open check.)
- Effects (atomic): `transfer_checked(amount)` payer ATA → escrow; then `invoice.payer = payer`, `paid_amount = amount`, `status = Paid`. `excess = amount - amount_due`.
- Event: `InvoicePaid { invoice, payer, amount, excess }`.

### 4. `merchant_claim()`

- Caller: `merchant` signer; must equal `invoice.merchant` else `UnauthorizedMerchant`.
- Accounts: `merchant` (signer), `invoice` (mut, PDA, `has_one = merchant`), `mint`, `escrow` (mut, == Invoice ATA), `merchant_ata` (init_if_needed, payer = merchant, authority = merchant), `token_program`, `associated_token_program`, `system_program`.
- Preconditions: `status == Paid` else `InvoiceNotPaid`; `!claimed` else `AlreadyClaimed`.
- Effects: `transfer_checked(amount_due)` escrow → merchant ATA (PDA signer); `claimed = true`. Never transfers more than `amount_due`.
- Event: `InvoiceClaimed { invoice, merchant, amount_due }`.

### 5. `refund_overpayment()`

- Caller: permissionless (any signer as fee payer).
- Accounts: `caller` (signer, fee payer), `invoice` (mut, PDA), `mint`, `escrow` (mut, == Invoice ATA), `payer_ata` (init_if_needed, payer = caller, authority = `invoice.payer`), `token_program`, `associated_token_program`, `system_program`.
- Preconditions: `status == Paid` else `InvoiceNotPaid`; `invoice.payer != Pubkey::default()` else `PayerNotRecorded`; `paid_amount > amount_due` else `NothingToRefund`; `refunded_excess == 0` else `AlreadyRefunded`; `payer_ata` authority == `invoice.payer` else `InvalidPayerAta`.
- Effects: `excess = paid_amount - amount_due`; `transfer_checked(excess)` escrow → recorded payer ATA (PDA signer); `refunded_excess = excess`.
- Event: `OverpaymentRefunded { invoice, payer, excess }`.

### 6. `expire_invoice()`

- Caller: permissionless (any signer as fee payer).
- Accounts: `caller` (signer), `invoice` (mut, PDA).
- Preconditions: `status == Open` else `InvoiceNotOpen` (covers Paid and already-Expired); `Clock.unix_timestamp >= expires_at` else `NotExpired`.
- Effects: `status = Expired`.
- Event: `InvoiceExpired { invoice, merchant }`.

### 7. `recover_unattributed(destination_ata)`

- Caller: `merchant` signer; must equal `invoice.merchant` else `UnauthorizedMerchant`.
- Accounts: `merchant` (signer), `invoice` (mut, PDA, `has_one = merchant`), `mint`, `escrow` (mut, == Invoice ATA), `destination_ata` (init_if_needed, payer = merchant, authority = merchant), `token_program`, `associated_token_program`, `system_program`.
- Preconditions, in order:
  - signer == `invoice.merchant` else `UnauthorizedMerchant`;
  - `status == Expired` → terminal OK;
  - `status == Paid && claimed` → if `paid_amount > amount_due && refunded_excess != paid_amount - amount_due` then `ExcessOutstanding`; otherwise terminal OK;
  - otherwise `InvoiceNotTerminal`;
  - `escrow.amount > 0` else `NothingToRecover`;
  - `destination_ata` authority == merchant else `InvalidPayerAta` (ATA authority mismatch).
- Equivalent terminal predicate: `(status == Expired) || (status == Paid && claimed && (paid_amount == amount_due || refunded_excess == paid_amount - amount_due))`.
- Effects: `transfer_checked(escrow.amount)` escrow → destination ATA (PDA signer).
- Event: `UnattributedRecovered { invoice, merchant, amount }`.

### 8. `close_invoice()`

- Caller: `merchant` signer; must equal `invoice.merchant` else `UnauthorizedMerchant`.
- Accounts: `merchant` (signer), `invoice` (mut, PDA, `has_one = merchant`, `close = merchant`), `mint`, `escrow` (mut, == Invoice ATA), `token_program`.
- Preconditions: same terminal + excess-cleared predicate as `recover_unattributed` else `InvoiceNotTerminal` / `ExcessOutstanding`; `escrow.amount == 0` else `VaultNotEmpty`. Open invoices cannot be closed.
- Effects: close escrow PDA-signed to merchant; close Invoice to merchant (`close = merchant`). Rent returns to merchant.
- Event: `InvoiceClosed { invoice, merchant }`.

## Events

Each event carries `invoice` (pubkey), `merchant`, relevant amounts, and `timestamp` (`Clock.unix_timestamp`).

| Event | Fields |
|---|---|
| InvoiceCreated | invoice, merchant, invoice_id, amount_due, expires_at, timestamp |
| InvoicePaid | invoice, payer, amount, excess, timestamp |
| InvoiceClaimed | invoice, merchant, amount_due, timestamp |
| OverpaymentRefunded | invoice, payer, excess, timestamp |
| InvoiceExpired | invoice, merchant, timestamp |
| UnattributedRecovered | invoice, merchant, amount, timestamp |
| InvoiceClosed | invoice, merchant, timestamp |

## Errors (start at 6000, Anchor ordering)

| Code | Name | Fires when |
|---|---|---|
| 6000 | Underpayment | `pay_invoice` amount < amount_due |
| 6001 | DuplicatePayment | `pay_invoice` on status != Open |
| 6002 | InvoiceNotOpen | `expire_invoice` status != Open (incl. Paid) |
| 6003 | InvoiceExpired | `pay_invoice` now >= expires_at |
| 6004 | InvoiceNotPaid | claim/refund when status != Paid |
| 6005 | AlreadyClaimed | `merchant_claim` when claimed |
| 6006 | AlreadyRefunded | `refund_overpayment` when refunded_excess != 0 |
| 6007 | NothingToRefund | `refund_overpayment` when paid_amount <= amount_due |
| 6008 | NotExpired | `expire_invoice` now < expires_at |
| 6009 | InvalidAmount | amount_due == 0 at create; amount == 0 at pay |
| 6010 | InvalidExpiry | expires_at <= now at create |
| 6011 | InvalidMint | wrong token program, decimals != 6, or mint != invoice.mint |
| 6012 | InvalidEscrow | escrow != Invoice ATA or wrong authority |
| 6013 | UnauthorizedMerchant | signer != invoice.merchant (claim/close/recover) |
| 6014 | InvalidPayerAta | payer ATA or recover destination ATA authority mismatch |
| 6015 | Overflow | arithmetic overflow (checked math) |
| 6016 | VaultNotEmpty | `close_invoice` escrow.amount != 0 |
| 6017 | InvoiceNotTerminal | recover/close while status not terminal |
| 6018 | ExcessOutstanding | recover/close while recorded excess unrefunded |
| 6019 | NothingToRecover | `recover_unattributed` escrow.amount == 0 |
| 6020 | PayerNotRecorded | refund/pay referencing default payer where a payer is required |
| 6021 | ConfigMintMismatch | passed mint != Config.usdc_mint (create/pay) |
