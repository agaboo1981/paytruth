# Paytruth program — security self-review (Anchor Engineer)

Scope: `programs/paytruth/src/**` at branch `feat/program`. Reviewed against docs/PROGRAM-SPEC.md and STATE-MACHINE.md. This is a self-review, not an audit; QA/Security does the independent pass (Q4).

## Checklist

| Area | Result | Where |
|---|---|---|
| Signer checks | OK. `merchant` is `Signer` on create/claim/recover/close; `payer` is `Signer` on pay and signs the payer→escrow transfer; refund/expire `caller` is a `Signer` (fee payer only, gains no authority). | instructions/* |
| Merchant authorization | OK. `has_one = merchant @ UnauthorizedMerchant` on claim/recover/close; invoice PDA re-derived from stored `invoice.merchant`, so a forged invoice cannot be substituted. | merchant_claim, recover_unattributed, close_invoice |
| Owner / type checks | OK. `Account<Invoice>`/`Account<Config>` check owner + discriminator; `Account<Mint>`/`Account<TokenAccount>` check classic Token owner; `Program<Token>` rejects Token-2022; config mint checked by hand (owner == Token program, Mint layout, decimals == 6). | all |
| PDA seeds and bumps | OK. Config `[b"config"]`, Invoice `[b"invoice", merchant, invoice_id LE]`; canonical bump stored at init; later validation uses `bump = invoice.bump` / `config.bump`; PDA signer seeds use the stored bump. | state.rs, instructions/* |
| Mint constraints | OK. create: `mint == config.usdc_mint` (ConfigMintMismatch). pay: `mint == invoice.mint` (InvalidMint) and `invoice.mint == config.usdc_mint`. claim/refund/recover/close: `mint == invoice.mint`. All transfers use `transfer_checked` with decimals 6. | |
| Escrow / ATA constraints | OK. Escrow must equal `ATA(invoice PDA, mint)` and have token owner == invoice PDA (InvalidEscrow). Recipient ATAs use `init_if_needed` with `associated_token::mint/authority/token_program`; refund recipient authority pinned with `address = invoice.payer @ InvalidPayerAta`; recover/claim recipient authority = merchant signer. | |
| Amount bounds | OK. Claim transfers exactly `amount_due` once (`claimed` flag). Refund transfers exactly `paid_amount - amount_due` once (`refunded_excess`). Recover only after terminal + excess cleared. No instruction takes an arbitrary withdrawal amount. | |
| Checked arithmetic | OK. Only subtraction is `paid_amount - amount_due`, via `checked_sub` → `Overflow`. `overflow-checks = true` in release profile. | |
| Re-init | OK. Invoice and Config use `init` (never `init_if_needed`); a live account cannot be re-initialized. Recreate-after-close yields a fresh Open invoice (spec-intended, A13b). | create_invoice, initialize_config |
| Close safety | OK. `close_invoice` requires terminal + excess cleared + escrow.amount == 0, closes the escrow via PDA-signed `close_account` to the merchant, then Anchor `close = merchant` zeroes the Invoice and returns rent. Open invoices cannot be closed. | close_invoice |
| Realloc | N/A — no realloc. | |
| Token-2022 | Rejected by design (classic-only `Program<Token>`, classic `Mint`/`TokenAccount` types, config owner check). Avoids transfer-fee / permanent-delegate / hook risks. | |
| CPI targets | Only the Token program (typed `Program<Token>`) and, via Anchor init, System + Associated Token programs. No arbitrary CPI. | |
| State-before/after CPI | pay updates state after the inbound transfer in the same instruction (atomic; classic Token has no re-entrancy hooks). Outbound flows set flags after transfer; any failure reverts the whole tx. | |

## Findings

- **F1 (Low, liveness/griefing) — escrow ATA pre-creation blocks `create_invoice` for one id.** The invoice PDA and its ATA address are predictable from `(merchant, invoice_id)`. Anyone can create that ATA first through the permissionless ATA program; `create_invoice` then fails because the escrow uses `init`. Funds are never at risk; the merchant (or SDK) can retry with a new `invoice_id`. Fix options: (a) `init_if_needed` on the escrow with the same `associated_token::` constraints (safe because mint and authority are validated, and any pre-seeded tokens become "unattributed", recoverable by the merchant after a terminal state), or (b) SDK retries with a fresh random u64 id. Kept `init` because the spec restricts `init_if_needed` to recipient ATAs — **needs Lead decision**.
- **F2 (Low, deploy-time) — `initialize_config` is first-caller-wins.** Whoever calls it first becomes `authority` and fixes `usdc_mint` forever (v1 has no admin update). Mitigation: run `initialize_config` in the same session as the devnet deploy and verify the Config account before announcing the program id. Optional hardening: require the signer to be the program upgrade authority.
- **F3 (Info) — the USDC freeze authority can freeze an escrow.** If Circle froze an escrow ATA, claim/refund/recover would fail. Out of program control; acceptable for the hackathon.
- **F4 (Info) — raw transfers into the escrow are unattributed.** By design (ARCHITECTURE limitations): they don't change status and are only recoverable by the merchant after terminal state.
- **F5 (Info) — `PayerNotRecorded` is defensive and unreachable** (Paid always records payer).
- **F6 (Info) — error-name overlap.** Error `InvoiceExpired` (6003) and event `InvoiceExpired` share a name per spec; distinct IDL namespaces, no runtime impact, but client code must import them carefully.

No High/Medium issues found in self-review. The test suite (H1-H11, A1-A25) exercises these checks; see the test output in the PR or report.
