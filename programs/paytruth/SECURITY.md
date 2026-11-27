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
| Re-init | OK. Invoice and Config use `init` (never `init_if_needed`); a live or tombstoned Invoice cannot be re-initialized (A13a, A13b, A26). `init_if_needed` only on the escrow ATA (create) and recipient ATAs, all with mint/authority constraints. | create_invoice, initialize_config |
| Close safety | OK. `close_invoice` requires terminal + excess cleared + escrow.amount == 0, closes the escrow via PDA-signed `close_account` to the merchant, then tombstones the Invoice (`status = Closed`, account kept) so the id can't be reused. Open invoices cannot be closed. No Anchor `close` on Invoice → no revival/reinit window. | close_invoice |
| Realloc | N/A — no realloc. | |
| Token-2022 | Rejected by design (classic-only `Program<Token>`, classic `Mint`/`TokenAccount` types, config owner check). Avoids transfer-fee / permanent-delegate / hook risks. | |
| CPI targets | Only the Token program (typed `Program<Token>`) and, via Anchor init, System + Associated Token programs. No arbitrary CPI. | |
| State-before/after CPI | pay updates state after the inbound transfer in the same instruction (atomic; classic Token has no re-entrancy hooks). Outbound flows set flags after transfer; any failure reverts the whole tx. | |

## Findings

- **F1 — FIXED (QA S3)** — now `init_if_needed` on the escrow ATA only; regression tests A13c. Original finding: **escrow ATA pre-creation blocks `create_invoice` for one id.** The invoice PDA and its ATA address are predictable from `(merchant, invoice_id)`. Anyone can create that ATA first through the permissionless ATA program; `create_invoice` then fails because the escrow uses `init`. Funds are never at risk; the merchant (or SDK) can retry with a new `invoice_id`. Fix options: (a) `init_if_needed` on the escrow with the same `associated_token::` constraints (safe because mint and authority are validated, and any pre-seeded tokens become "unattributed", recoverable by the merchant after a terminal state), or (b) SDK retries with a fresh random u64 id. Kept `init` because the spec restricts `init_if_needed` to recipient ATAs — **needs Lead decision**.
- **F2 (Low, deploy-time) — `initialize_config` is first-caller-wins.** Whoever calls it first becomes `authority` and fixes `usdc_mint` forever (v1 has no admin update). Mitigation: run `initialize_config` in the same session as the devnet deploy and verify the Config account before announcing the program id. Optional hardening: require the signer to be the program upgrade authority.
- **F3 (Info) — the USDC freeze authority can freeze an escrow.** If Circle froze an escrow ATA, claim/refund/recover would fail. Out of program control; acceptable for the hackathon.
- **F4 (Info) — raw transfers into the escrow are unattributed.** By design (ARCHITECTURE limitations): they don't change status and are only recoverable by the merchant after terminal state.
- **F5 (Info) — `PayerNotRecorded` is defensive and unreachable** (Paid always records payer).
- **F7 — FIXED (QA M2)** — invoice substitution: `pay_invoice` requires `expected_amount_due` (InvoiceMismatch 6022) and invoice_id reuse is impossible (Closed tombstone keeps the PDA). Tests M2, A13b, A26, A28.
- **F8 — covered (QA S2/M1)** — decoy escrow / wrong mint / Token-2022 program on claim/refund/recover/close rejected; escrow derived from `invoice.mint`. Tests X8, X9, X11.
- **F6 (Info) — error-name overlap.** Error `InvoiceExpired` (6003) and event `InvoiceExpired` share a name per spec; distinct IDL namespaces, no runtime impact, but client code must import them carefully.

No High/Medium issues found in self-review. The test suite (H1-H11, A1-A25) exercises these checks; see the test output in the PR or report.

## L5 — Upgrade authority (closed 2026-11-27 11:58 WAT)

QA L5 (`qa/paytruth-spec-review.md`): the spec did not record whether the program is upgradeable or who holds upgrade authority.

**Devnet status:** the program is upgradeable. `solana program show D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H --url devnet` after the 11:58 WAT deploy (slot 526845320) reports:

- Authority: `8w3kGAyCZy2uHVHbvtxQvTRzjVHQF8fPh1YshkE4H3xB` (the gitignored devnet deployer keypair; pubkey only)
- ProgramData: `t7u7WGfXC3Toqx4z9nkdj5D45HCJXCFFx57stin1SA9`
- Data Length: 269728 bytes

The deployer keypair lives outside the repo (`~/.config/solana/paytruth-devnet-deployer.json`) and is **devnet only**. It is not committed and must never be printed. This is acceptable for the hackathon devnet, not for mainnet custody.

**Plan before any mainnet deploy (do not do this now):**

1. Transfer upgrade authority to a Squads (or equivalent) multisig, or
2. Mark the program immutable with `solana program set-upgrade-authority <PROGRAM_ID> --final` on the intended cluster.

No authority transfer and no `--final` is performed on devnet in this change. Mainnet remains out of scope. The upgrade-authority field is recorded in `programs/DEPLOYMENTS.md`.

## M6 — `has_one` vs `UnauthorizedMerchant` (closed)

QA M6 (`qa/paytruth-spec-review.md`): a bare Anchor `has_one = merchant` constraint emits `ConstraintHasOne` (2001) before any custom `require!`, so TEST-PLAN A12a (`UnauthorizedMerchant` / 6013) would fail unless the constraint is mapped or the test is loosened.

**Program fix (already in `237152f` / `f50f8bd`, no further bytecode change):** the merchant-gated instructions use a mapped constraint, which keeps Anchor's declarative `has_one` check and returns the spec error:

```rust
has_one = merchant @ PaytruthError::UnauthorizedMerchant
```

This is set on `merchant_claim`, `close_invoice`, and `recover_unattributed`. `UnauthorizedMerchant` remains 6013 in `error.rs`.

**Tests:** `programs/paytruth/tests/a12a_wrong_merchant_signer.rs` asserts `assert_custom_error(..., 6013)` on claim, close, and recover, and checks that a wrong signer causes no state or token movement (`claimed` stays false, escrow balance unchanged, attacker ATA stays 0, invoice/escrow accounts remain). Re-verified at `f50f8bd` with `cargo test -p paytruth -- --test-threads=4`: 60 passed, 0 failed, 0 ignored. No additional program change was required to close M6.

