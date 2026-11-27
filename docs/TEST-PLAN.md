# Paytruth Test Plan

Two layers plus a QA adversarial pass:

1. `anchor test` on localnet (default) — unit/integration of every instruction, transition, and attack. Clock warping for expiry. Localnet always uses a freshly created 6-decimal legacy-SPL test mint (never Circle devnet).
2. Devnet E2E script — runs the 7 official demo steps against the deployed program with real signatures (no mocked success).
3. QA adversarial list — mapped to automated tests where possible; manual on devnet where needed.

## Test harness

| Item | Value |
|---|---|
| Framework | Anchor `anchor test` (ts-mocha), `solana-program-test`/local validator default |
| Local mint | fresh 6-decimal legacy SPL mint created per suite |
| Clock | warp via bank/tests to `expires_at` boundaries |
| Assertions | on-chain Invoice account fields + SPL balances, not logs |

## A. Instruction happy paths

| ID | Test | Asserts |
|---|---|---|
| H1 | initialize_config | Config PDA created; `authority`, `usdc_mint`, `bump` set; size 73 |
| H2 | create_invoice | Invoice Open; fields set; memo padded to 64; escrow ATA exists (authority = invoice); size 219 |
| H3 | pay exact | transfer moved; status Paid; paid_amount == amount_due; payer recorded; excess 0 |
| H4 | pay over | status Paid; paid_amount > amount_due; excess == paid - due; full amount in escrow |
| H5 | merchant_claim | amount_due escrow→merchant; claimed true; vault holds only excess |
| H6 | refund_overpayment | excess escrow→payer ATA; refunded_excess == excess |
| H7 | refund before claim and after claim | both succeed; refund allowed before/after claim |
| H8 | expire_invoice at/after expires_at | status Expired |
| H9 | recover_unattributed (Expired, stray funds) | vault drained to merchant dest |
| H10 | close_invoice (empty vault) | escrow + Invoice closed; rent to merchant |
| H11 | PAID flow: pay exact → claim → close | terminal and closed; vault empty |

## B. Required attack tests

| ID | Attack | Expected |
|---|---|---|
| A1 | double pay (second `pay_invoice`) | `DuplicatePayment`, no transfer |
| A2 | claim twice | `AlreadyClaimed` |
| A3 | claim before paid (on Open) | `InvoiceNotPaid` |
| A4 | claim more than due | No amount arg exists; try to drain vault (> amount_due) via `merchant_claim` — transfer capped at amount_due; excess remains in vault |
| A5 | refund to wrong account (dest ATA not owned by recorded payer) | `InvalidPayerAta` |
| A6 | refund twice | `AlreadyRefunded` |
| A7 | pay after expiry without `expire_invoice` | `InvoiceExpired`, no transfer |
| A8 | expire before time | `NotExpired` |
| A9 | expire a Paid invoice | `InvoiceNotOpen` |
| A10 | wrong mint | `InvalidMint` |
| A11 | fake escrow (non-ATA or wrong authority) | `InvalidEscrow` |
| A12a | wrong merchant signer on claim/close/recover | `UnauthorizedMerchant` |
| A12b | `create_invoice` with PDA seeds of a different merchant | Anchor seeds constraint failure |
| A13a | reinit while Invoice exists (`init`) | fails (account in use) |
| A13b | close then recreate same id | NEW Open invoice succeeds (expected behaviour) |
| A14 | pay with Token-2022 mint / wrong token program | token program check rejects (`InvalidMint`/program error) |
| A15 | underpayment | `Underpayment`, no transfer, no state |
| A16 | zero amount create / zero amount pay | `InvalidAmount` |
| A17 | expiry in the past on create | `InvalidExpiry` |
| A18 | recover before terminal | `InvoiceNotTerminal` |
| A19 | recover while excess outstanding (Paid, claimed, excess not refunded) | `ExcessOutstanding` |
| A20 | close with non-empty vault | `VaultNotEmpty` |
| A21 | direct transfer into vault then recover after terminal | status unchanged by direct transfer; after Expired, `recover_unattributed` drains vault |
| A22 | refund when no excess | `NothingToRefund` |
| A23 | recover on empty vault | `NothingToRecover` |
| A24 | close an Open invoice | `InvoiceNotTerminal` |
| A25 | claim on Expired | `InvoiceNotPaid` |

## C. State-machine coverage

Every edge in [STATE-MACHINE.md](./STATE-MACHINE.md) has a test: Open→Paid (H3/H4), Open→Expired (H8), Paid→Paid claim (H5), Paid→Paid refund (H6), Paid→Closed (H11), Expired→Closed (H8→H9→H10). Every rejected transition (§Rejected transitions) maps to A1–A25.

## D. Idempotency / RPC behaviour (client, mocked RPC harness)

| ID | Test | Expected |
|---|---|---|
| D1 | send timeout → refetch before resubmit | no duplicate tx submitted when chain already Paid |
| D2 | resubmit after blockhash expiry on unlanded tx | rebuild+resign; single on-chain effect |
| D3 | `waitForInvoiceState` resolves on `confirmed` then `finalized` | predicate seen at requested commitment |

## E. Devnet E2E — 7 official demo steps

Real signatures against the deployed program; script asserts on-chain state after each step.

| Step | Action | Pass condition |
|---|---|---|
| 1 | Merchant creates an invoice | Invoice Open on-chain; escrow ATA exists |
| 2 | Customer pays exact | status Paid; paid_amount == amount_due |
| 3 | Merchant verifies and claims | claimed true; merchant balance +amount_due |
| 4 | Customer attempts duplicate payment | tx fails on-chain (`DuplicatePayment`); state unchanged |
| 5 | Overpayment refunded (new invoice: pay > due, then `refund_overpayment`) | refunded_excess == excess; payer balance restored |
| 6 | Expired invoice (short expiry, `expire_invoice`, pay fails, close) | pay fails (`InvoiceExpired`); status Expired; closed |
| 7 | Independent observer verifies via `/verify/?invoice=<invoicePda>` (no merchant/payer wallet) | page renders on-chain status; reads Invoice + escrow balance directly |

QA must run all seven steps on devnet before the video is recorded. Record each signature + final state in the submission notes.

## F. QA adversarial checklist (manual + automated)

- [ ] Underpay rejected with no partial state.
- [ ] Overpay: full amount escrowed atomically; refund to recorded payer only.
- [ ] Claim capped at amount_due; excess never claimable.
- [ ] Expiry boundary: now == expires_at rejects pay, allows expire.
- [ ] Paid invoice cannot expire; claim/refund still work after expiry window passes.
- [ ] recover/close blocked until terminal + excess cleared.
- [ ] Direct transfer does not change status; recoverable by merchant after terminal.
- [ ] Token-2022 lookalike rejected.
- [ ] Reinit: cannot reinit live account; recreate-after-close yields fresh invoice.
- [ ] No instruction lets a backend or third party set Paid without funds in escrow.
- [ ] Verify page never trusts off-chain data for Paid/Claimed.
