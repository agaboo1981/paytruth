# Paytruth

Paytruth is a wallet-to-wallet USDC invoice escrow on Solana. The Anchor program is the source of truth: payments, claims, refunds, and expiry are enforced in an on-chain escrow, not by a backend. `pay_invoice` atomically transfers USDC from the payer to the escrow and sets status to Paid in the same instruction; `merchant_claim` is capped at `amount_due` and can run once. That closes the failure mode where a backend or merchant could self-declare an invoice paid without funds moving. The `/verify/[invoicePda]` page reads the Invoice account and escrow token balance directly from RPC.

## Official 7-step demo

These are the steps in [`docs/TEST-PLAN.md` §E](docs/TEST-PLAN.md):

1. **Merchant creates an invoice** — Invoice is `Open` on-chain; the escrow ATA exists.
2. **Customer pays exact** — status becomes `Paid`; `paid_amount == amount_due`.
3. **Merchant verifies and claims** — `claimed` is true; the merchant balance increases by `amount_due`.
4. **Customer attempts a duplicate payment** — the on-chain instruction fails with `DuplicatePayment`; state is unchanged.
5. **Overpayment refunded** — on a new invoice, pay more than due, then call `refund_overpayment`; `refunded_excess == excess` and the excess is returned to the recorded payer (the due amount stays in escrow until claim).
6. **Expired invoice** — with a short expiry, a late pay fails with `InvoiceExpired`; expire the invoice (`Expired`), then close it (`Closed`).
7. **Independent observer verifies** — `/verify/[invoicePda]` renders on-chain status with no merchant or payer wallet, reading the Invoice account and escrow balance directly from RPC.

## Devnet deployment

Recorded in [`programs/DEPLOYMENTS.md`](programs/DEPLOYMENTS.md) (deployed 2026-11-27 11:58 WAT). That file also has the deploy and `initialize_config` transaction links.

| Identifier | Value |
|---|---|
| Program ID | [`D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H`](https://explorer.solana.com/address/D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H?cluster=devnet) |
| Config PDA | [`C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx`](https://explorer.solana.com/address/C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx?cluster=devnet) |
| Circle devnet USDC mint | [`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`](https://explorer.solana.com/address/4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU?cluster=devnet) (6 decimals, classic SPL Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |
| Upgrade authority | [`8w3kGAyCZy2uHVHbvtxQvTRzjVHQF8fPh1YshkE4H3xB`](https://explorer.solana.com/address/8w3kGAyCZy2uHVHbvtxQvTRzjVHQF8fPh1YshkE4H3xB?cluster=devnet) (gitignored deployer key) |

The official runner defaults to `https://api.devnet.solana.com`. It refuses any RPC URL containing `mainnet` and checks the devnet genesis hash before sending transactions.

## Setup and how to run

Toolchain pinned in the repository: Anchor 1.2.2 with anchor-spl 1.2.2, and Rust 1.89.0 via `rust-toolchain.toml`. No Node or pnpm version is pinned. The official program keypair must match the deployed program id; it is gitignored at `target/deploy/paytruth-keypair.json`.

### LiteSVM program suite

From the repository root:

```sh
anchor build --ignore-keys
cargo test -p paytruth -- --test-threads=4
```

`[scripts] test` in `Anchor.toml` is already `cargo test -p paytruth -- --test-threads=4`, so `anchor test` runs the LiteSVM suite without a validator.

### Validator and adversarial suite

TypeScript / Anchor validator tests need `anchor test --validator legacy`, because Anchor 1.2.2 otherwise defaults to surfpool. The adversarial suite is TypeScript and is **not in this tree** yet: `tests/adversarial/` contains only `.gitkeep` on `main`. Once it is merged (and an `adversarial` script is added to `Anchor.toml`), run:

```sh
anchor test --validator legacy --script adversarial
```

### Devnet demo

From `sdk/`:

```sh
cd sdk
pnpm install
pnpm devnet:check
PAYTRUTH_DEVNET_RPC=https://api.devnet.solana.com \
PAYTRUTH_MERCHANT_KEYPAIR=/absolute/path/outside/repo/merchant.json \
PAYTRUTH_PAYER_KEYPAIR=/absolute/path/outside/repo/payer.json \
pnpm devnet:demo
```

Keypairs are `solana-keygen` JSON files that must live **outside** the git repository (the runner refuses in-repo paths). Never commit or print them. `PAYTRUTH_PROGRAM_ID`, `PAYTRUTH_CONFIG_PDA`, and `PAYTRUTH_USDC_MINT` are optional overrides; otherwise they are parsed from [`programs/DEPLOYMENTS.md`](programs/DEPLOYMENTS.md). The merchant needs at least 0.05 SOL; the payer needs at least 0.01 SOL and 2.50 Circle devnet USDC (defaults: 1.00 exact payment + 1.50 overpayment). `pnpm devnet:check` sends no transactions. The runner never logs secret key bytes.

### App

The Next.js 14 App Router app lives under `app/`. Its lockfile is `package-lock.json` (`npm ci` works); pnpm can still run the scripts. There is no public hosted URL yet.

```sh
cd app
# copy app/.env.example to .env.local:
# NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
# NEXT_PUBLIC_PAYTRUTH_SDK=real
# NEXT_PUBLIC_PAYTRUTH_PROGRAM_ID=<optional; defaults to the IDL / devnet program id>
pnpm install   # or npm ci
pnpm dev
# production: pnpm build && pnpm start
# official UI e2e against a local production server + devnet: pnpm test:devnet
```

## Architecture

- **Program** — [`programs/paytruth`](programs/paytruth) exposes eight instructions: `initialize_config`, `create_invoice`, `pay_invoice(amount, expected_amount_due)`, `merchant_claim`, `refund_overpayment`, `expire_invoice`, `recover_unattributed`, and `close_invoice`. Invoice PDA seeds are `[b"invoice", merchant, invoice_id.to_le_bytes()]`; Config PDA seeds are `[b"config"]`. The Invoice account is 219 bytes (8 + 211); Config is 73 bytes.
- **Invoice state machine (as implemented)** — `Uninitialized → Open` via `create_invoice`. `Open → Paid` via `pay_invoice` when `now < expires_at`, `amount >= amount_due`, and `expected_amount_due` matches the invoice. `Open → Expired` via `expire_invoice` when `now >= expires_at`. `Paid` supports `merchant_claim` and `refund_overpayment` (`claimed` and `refunded_excess` flags) and cannot transition to `Expired`. `close_invoice` requires a terminal state, cleared excess, and an empty vault: it closes the escrow ATA to the merchant and leaves a `Closed` **tombstone** — the Invoice account is kept so the same `invoice_id` can never be re-initialized, and its rent stays locked by design. See [`close_invoice.rs`](programs/paytruth/src/instructions/close_invoice.rs) and [`programs/paytruth/SECURITY.md`](programs/paytruth/SECURITY.md).
- **SDK** — [`sdk/`](sdk/) (`@paytruth/sdk`) provides PDA helpers, instruction builders, reads, error mapping, and React hooks; see [`sdk/README.md`](sdk/README.md).
- **Devnet client runner** — [`sdk/scripts/devnet/demo.ts`](sdk/scripts/devnet/demo.ts) powers `pnpm devnet:demo` and `pnpm devnet:check`.
- **UI** — [`app/`](app/) provides `/merchant/new`, `/merchant/[invoicePda]`, `/pay/[invoicePda]`, `/verify`, `/verify/[invoicePda]`, and `/states`. It uses the real SDK against devnet, or `NEXT_PUBLIC_PAYTRUTH_SDK=mock` for a UI-only demo.

Further reading: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/PROGRAM-SPEC.md`](docs/PROGRAM-SPEC.md), [`docs/STATE-MACHINE.md`](docs/STATE-MACHINE.md), [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md), [`docs/INTERFACES.md`](docs/INTERFACES.md), [`docs/SCHEDULE.md`](docs/SCHEDULE.md), [`programs/DEPLOYMENTS.md`](programs/DEPLOYMENTS.md), [`programs/paytruth/SECURITY.md`](programs/paytruth/SECURITY.md), [`sdk/README.md`](sdk/README.md), and [`qa/final-qa-main.md`](qa/final-qa-main.md).

Note: [`docs/STATE-MACHINE.md`](docs/STATE-MACHINE.md) and the close section of [`docs/PROGRAM-SPEC.md`](docs/PROGRAM-SPEC.md) still describe close as deleting the Invoice account, returning rent, and allowing id reuse. Those descriptions are stale; the tombstone behaviour above is what the program implements.

## Evidence

The final QA report for SHA `ce15926a4137b1b4672c1a91638a263f8d4c0145` (2026-11-27) is [`qa/final-qa-main.md`](qa/final-qa-main.md). Transaction signatures and devnet explorer links are there; they are not repeated here.

- Official 7-step devnet demo: **7/7 PASS** (`DEMO_EXIT:0`), 14:41:15–14:42:20 WAT.
- Playwright UI write-flow (local real-SDK app; no public URL): **3 passed / 0 failed**.
- LiteSVM `cargo test -p paytruth`: **60 passed / 0 failed**.
- Adversarial TypeScript suite: **44 passing / 0 failing**, run against that SHA from a `qa/tests` overlay; those test files are not on `main` yet.

## Limitations

- Direct SPL transfers or plain Solana Pay payments into the escrow ATA are **not attributed** and do not change invoice status. After a terminal state, and after any recorded overpayment has been refunded, the merchant may drain leftovers with `recover_unattributed`. Accidental senders cannot reclaim those tokens through the program.
- Rent-dust nit: after close, the escrow ATA is closed, but a third party can later re-create that same ATA and send stray tokens. The merchant can recover them with `recover_unattributed`, but `close_invoice` on an already-`Closed` invoice returns `InvoiceNotTerminal`, so there is no instruction to close that later empty ATA and its rent remains as dust. Verified in [`a27_recover_after_close_from_recreated_escrow.rs`](programs/paytruth/tests/a27_recover_after_close_from_recreated_escrow.rs) and [`close_invoice.rs`](programs/paytruth/src/instructions/close_invoice.rs).
- Upgrade authority remains with the gitignored devnet deployer key (`8w3kGAyCZy2uHVHbvtxQvTRzjVHQF8fPh1YshkE4H3xB`). It has not been transferred to a multisig, and the program is not marked final. Devnet only.
- `initialize_config` is first-caller-wins: the first successful caller becomes `Config.authority` and fixes `usdc_mint` for v1 (no admin update). It should be run immediately after deploy and the Config account verified. On this devnet deploy that was done; see [`programs/DEPLOYMENTS.md`](programs/DEPLOYMENTS.md).
- Devnet only. Not audited. No hosted public URL yet.
- Circle (or any USDC issuer) freeze authority could freeze an escrow ATA; that is outside the program's control.
- Local program tests use a fresh 6-decimal classic SPL mint, never the Circle mint.

## Honest disclosure

Paytruth was built during the Dev3pack Global Hackathon, 27–29 November 2026.

**Pre-existing vs weekend work.** Git history in this repository starts at `45150707f8a0f54740f378ac37448929d1f75b08` on 2026-11-27 09:54 WAT (“Initial Paytruth monorepo scaffold”), with no earlier commits. No pre-existing Solana product or earlier personal project was imported into this repository. The first commit is a same-day scaffold: architecture docs, the MIT licence, an Anchor placeholder `initialize` / `increment` program (replaced later the same day by the real invoice program, merged as `237152f`), and UI design-kit primitives committed into this repository that day. If any design work existed only outside git before that first commit, it is not visible in this history; we make no claim about offline sketches either way.

**AI assistance.** Built with AI assistance: a team of AI agents directed by Joshua Adesina, plus OpenCode models (including caffeine/router and big-pickle) used to draft code, tests, and documentation, then reviewed and corrected by the team. The official Dev3pack FAQ allows AI tools when the project is yours, you understand it, and you can demo and explain it. Open-source libraries and templates (Anchor, Next.js, Solana web3.js / wallet-adapter, LiteSVM, Playwright, and others) are used as dependencies. This is not a fork of someone else’s hackathon project.

## Licence

[MIT](LICENSE). Copyright (c) 2026 Joshua Anuoluwapo Adesina. The root `package.json` also declares `"license": "MIT"`.
