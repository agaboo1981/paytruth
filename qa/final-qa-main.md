# Final QA pass — main `ce15926` (devnet)

- **When:** 2026-11-27 14:23–14:53 WAT (Africa/Lagos, UTC+1). Run early, ahead of the Sat 15:00 schedule.
- **SHA tested (full):** `ce15926a4137b1b4672c1a91638a263f8d4c0145`
- **Commit:** `Merge feat/ui: full Paytruth UI wired to devnet (108 vitest, 43 Playwright, 0 axe)` (Joshua, 2026-11-27 14:22:24 +0100)
- **Worktree:** `/workspace/paytruth-wip/wt-main-ce15926` (detached `origin/main` after `git fetch`; main was not checked out as a branch, not modified, not pushed, not force-pushed)
- **Deployed program (from `programs/DEPLOYMENTS.md` / `--check` / this run):**
  - Program ID: `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H`
  - Config PDA: `C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx`
  - Circle devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
  - RPC: `https://api.devnet.solana.com` (devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; never mainnet)
- **Official runner:** `sdk/scripts/devnet/demo.ts` via `pnpm devnet:demo` (TEST-PLAN §E)
- **Verdict:** **PASS.** Official 7-step devnet demo overall PASS (`DEMO_EXIT:0`). Local LiteSVM suite 60/60. Adversarial TS suite 44/44 (overlay; not on main). Local real-SDK Playwright write-flow 3/3 PASS. Official demo `/verify` pages render 1/1 PASS. No public live demo URL (local app only).

Nothing below is fabricated. Anything not actually executed is marked **NOT RUN** with the reason.

---

## Funding

First attempt (14:26–14:28 WAT) used throwaway wallets funded only by official `solana airdrop`. Both airdrops were rate-limited; balances stayed 0 SOL; that run was recorded as blocked and was **not** worked around. Unfunded log preserved at `/workspace/paytruth-wip/qa-logs/main-ce15926-devnet-demo-unfunded.log`.

Team Lead then unblocked the pass and authorised the already-funded **devnet** demo keypairs already on the box (paths only; never printed, never copied into the repo, never committed):

- Merchant: `/workspace/fs-notes/devnet-keys/merchant.json` — pubkey `7ne9NUuCXd8jMo6BuvX6feeDpipCH6X5bEfc571mz26y`
- Payer: `/workspace/fs-notes/devnet-keys/payer.json` — pubkey `DB1MjDJmMp2DUgVzqvUDBqSVmS2cJfjLExmV8tCgXx5b`

Verified on `https://api.devnet.solana.com` with `solana balance` and `spl-token` **before** the live demo (14:38 WAT):

| Role | SOL | USDC | Required by runner |
|------|-----|------|--------------------|
| Merchant | 0.41191124 | 4 | ≥ 0.05 SOL, 0 USDC |
| Payer | 0.39844656 | 13.5 | ≥ 0.01 SOL, 2.50 USDC |

(Lead note said “about 0.7 SOL”; measured SOL was ~0.41 / ~0.40, still above the runner floors.)

After official demo (14:42 WAT): merchant 0.40361608 SOL / 6 USDC; payer 0.39841656 SOL / 11.5 USDC.  
After UI write-flow (14:51 WAT): merchant 0.39680436 SOL / 7 USDC; payer 0.39840156 SOL / 9.5 USDC.

---

## 1. Worktree and SHA — **PASS**

```
git fetch origin
git worktree add --detach /workspace/paytruth-wip/wt-main-ce15926 origin/main
git rev-parse HEAD
# ce15926a4137b1b4672c1a91638a263f8d4c0145
```

---

## 2. Official 7 demo steps on devnet — **PASS** (all 7)

Command (from `/workspace/paytruth-wip/wt-main-ce15926/sdk`):

```
PAYTRUTH_DEVNET_RPC=https://api.devnet.solana.com \
PAYTRUTH_MERCHANT_KEYPAIR=/workspace/fs-notes/devnet-keys/merchant.json \
PAYTRUTH_PAYER_KEYPAIR=/workspace/fs-notes/devnet-keys/payer.json \
pnpm devnet:demo
# DEMO_EXIT:0
# overall: PASS
# started:  2026-11-27 14:41:15 WAT
# finished: 2026-11-27 14:42:20 WAT
```

- Log (secret-scanned; no key-byte arrays): `/workspace/paytruth-wip/qa-logs/main-ce15926-devnet-demo.log`
- Machine report: `/workspace/paytruth-wip/qa-logs/devnet-demo-ce15926/2026-11-27T13-42-20-939Z.json` (copy of gitignored `sdk/.devnet-runs/…`; SHA worktree left clean)

Invoices created in this pass:

| Invoice | PDA | Final status (runner) |
|---------|-----|------------------------|
| A | `7L4xu4Egfn4MeR5inP9s6QMBDNZcrk3tfqi6cbWYoorK` | Paid (claimed); escrow 0 |
| B | `wtnBun8ZJTQrBMYQ5o7U7MabiEyUwzqZdaz4h9naC2X` | Paid (claimed, excess refunded); escrow 0 |
| C | `CkewpeJ1hMeV5guHv7cCuA34UCFKGdFjgejQ2SJQLJBf` | Closed tombstone; escrow ATA closed |

Explorer base: `https://explorer.solana.com/tx/<sig>?cluster=devnet`

### Step 1 — Merchant creates invoice A — **PASS**

Invoice A Open on-chain; `amountDue=1000000`; escrow ATA `753WhBGvVaug8FvWoY4gJFmqYPapSBNBtMy6pn42JG4N` exists with balance 0.

- createInvoice A: [`4A75fNnWAjuvXQVbFxzvQxZZBPUpRWjYE6hXdfVSm7g8C12csMwjfUfASQATGjqYNMVT8pHLVuuNkiKJP9iXCgFd`](https://explorer.solana.com/tx/4A75fNnWAjuvXQVbFxzvQxZZBPUpRWjYE6hXdfVSm7g8C12csMwjfUfASQATGjqYNMVT8pHLVuuNkiKJP9iXCgFd?cluster=devnet)

### Step 2 — Customer pays exact — **PASS**

Status Paid; `paid=1000000 due=1000000`; payer recorded as `DB1Mj…`; escrow == due; payer USDC decreased by due.

- payInvoice A exact: [`31aLAFchgu3k7TWAm5aShWJ5R7Ejb4wffyPt6cEPD6E8wUEqxiLzTKH9DVENab1CHuXP1VNBWqb1xFJ7Mrswty2T`](https://explorer.solana.com/tx/31aLAFchgu3k7TWAm5aShWJ5R7Ejb4wffyPt6cEPD6E8wUEqxiLzTKH9DVENab1CHuXP1VNBWqb1xFJ7Mrswty2T?cluster=devnet)

### Step 3 — Merchant verifies and claims — **PASS**

Invoice A claimed; merchant USDC increased by due; escrow A empty.

- merchantClaim A: [`4rLcBLZupjKDtaTRKK2XRVME1UqH7Eic2MVkJ4BmQrdcrBkRFcaBGa5Nqv6vDXS1X4qrWxaX7f8EdmnPm1rRbNab`](https://explorer.solana.com/tx/4rLcBLZupjKDtaTRKK2XRVME1UqH7Eic2MVkJ4BmQrdcrBkRFcaBGa5Nqv6vDXS1X4qrWxaX7f8EdmnPm1rRbNab?cluster=devnet)

### Step 4 — Duplicate payment blocked — **PASS**

On-chain tx failed with `DuplicatePayment`; invoice state and payer balance unchanged.

- duplicate payInvoice A (expected-failure): [`2i9xLQzEwWvvJKw8Fw9gknW62wbNRbqxEgiSNNVXRxaGVwJCM2uwZrYRHYncnMd1tVdJ3VmzjmSeFaio1xWLvsjk`](https://explorer.solana.com/tx/2i9xLQzEwWvvJKw8Fw9gknW62wbNRbqxEgiSNNVXRxaGVwJCM2uwZrYRHYncnMd1tVdJ3VmzjmSeFaio1xWLvsjk?cluster=devnet)

### Step 5 — Overpayment refunded — **PASS**

New invoice B: paid 1.50 against 1.00 due (`paid=1500000`); `refunded=500000`; payer restored to before − due; then B claimed clean.

- createInvoice B: [`5PZA8MhFU4T3hGfLmQ7n4wH8qgnQz75Kff2bbSxo3dn78KK5QZ9waczJSx4k6QkYdwwBUJuuDj68y2Di5Y1oV2Dg`](https://explorer.solana.com/tx/5PZA8MhFU4T3hGfLmQ7n4wH8qgnQz75Kff2bbSxo3dn78KK5QZ9waczJSx4k6QkYdwwBUJuuDj68y2Di5Y1oV2Dg?cluster=devnet)
- payInvoice B (overpay): [`3vNSwczNEnsT68YeGJgNxayPkLvA1mkQYqeLPC29cUnRqHDhN4wYgT5X6UTLtfy7jjP1iCqAYzxTyD59fiBSKUiE`](https://explorer.solana.com/tx/3vNSwczNEnsT68YeGJgNxayPkLvA1mkQYqeLPC29cUnRqHDhN4wYgT5X6UTLtfy7jjP1iCqAYzxTyD59fiBSKUiE?cluster=devnet)
- refundOverpayment B: [`41LKkiWJ5Q6XBnYCkjYTBBNdrrJTwxqv9J67sV9LXUuehQXq1RZUcGcu6XGxoibTr9bfVroFKv6SRCc4nbyfA2YM`](https://explorer.solana.com/tx/41LKkiWJ5Q6XBnYCkjYTBBNdrrJTwxqv9J67sV9LXUuehQXq1RZUcGcu6XGxoibTr9bfVroFKv6SRCc4nbyfA2YM?cluster=devnet)
- merchantClaim B: [`4rvCvJzU24qSpvmTrDawThJM8v9Kqf5ym8TNswe5uVXYY2UmKx7Hmfb4ZheEytbqFs9iTL9dgC7uB73eZxi1Ucsm`](https://explorer.solana.com/tx/4rvCvJzU24qSpvmTrDawThJM8v9Kqf5ym8TNswe5uVXYY2UmKx7Hmfb4ZheEytbqFs9iTL9dgC7uB73eZxi1Ucsm?cluster=devnet)

### Step 6 — Expired invoice handled — **PASS**

Create C; pay after expiry failed on-chain with `InvoiceExpired` (C still Open); `expireInvoice` → Expired; `closeInvoice` leaves Closed tombstone; escrow ATA closed.

- createInvoice C: [`23NS9yN5pV2k37vnfdz4yizNf8BZDvBcwjaz5PCQ2RSw989KvUkPQPKQegzWNGga2zA8BzmwfJE9gnJYxosarKLv`](https://explorer.solana.com/tx/23NS9yN5pV2k37vnfdz4yizNf8BZDvBcwjaz5PCQ2RSw989KvUkPQPKQegzWNGga2zA8BzmwfJE9gnJYxosarKLv?cluster=devnet)
- payInvoice C expired (expected-failure): [`2ViUGSnQnDhxFSAwYG4D6Hk7AfJPvJsP8K5Gtt3oMG9CdGtu1TffBfHXEeV45WkHmAMG4CLXjt5uhxoVWDYPbSNw`](https://explorer.solana.com/tx/2ViUGSnQnDhxFSAwYG4D6Hk7AfJPvJsP8K5Gtt3oMG9CdGtu1TffBfHXEeV45WkHmAMG4CLXjt5uhxoVWDYPbSNw?cluster=devnet)
- expireInvoice C: [`5RMVaTQKUhyko9YniKvbCBqY5DZD84PyPhuuprB5TwgdBdvjn8JpUdnNhVgrGxtZxgWXuY5Nthdtbtx86gdnVWcN`](https://explorer.solana.com/tx/5RMVaTQKUhyko9YniKvbCBqY5DZD84PyPhuuprB5TwgdBdvjn8JpUdnNhVgrGxtZxgWXuY5Nthdtbtx86gdnVWcN?cluster=devnet)
- closeInvoice C: [`4fktAHSPEp8gGp9KyZqTiFuug97HTjfUjnoqNExHFAxeoy7493gAMRxAzThLfJaTrbA6CsmhK9oUHes3nyg8Q8md`](https://explorer.solana.com/tx/4fktAHSPEp8gGp9KyZqTiFuug97HTjfUjnoqNExHFAxeoy7493gAMRxAzThLfJaTrbA6CsmhK9oUHes3nyg8Q8md?cluster=devnet)

### Step 7 — Independent observer `/verify/[invoicePda]` — **PASS**

Runner asserted A Paid / B Paid / C Closed from chain (no wallet) and printed verify paths. Separately, the local real-SDK app was started and Playwright loaded those pages (no wallet) — 1 passed in 4.4s (14:51:38–14:51:43 WAT):

- `/verify/7L4xu4Egfn4MeR5inP9s6QMBDNZcrk3tfqi6cbWYoorK` — Paid & claimed
- `/verify/wtnBun8ZJTQrBMYQ5o7U7MabiEyUwzqZdaz4h9naC2X` — Paid & claimed
- `/verify/CkewpeJ1hMeV5guHv7cCuA34UCFKGdFjgejQ2SJQLJBf` — Closed

Screenshots: `/workspace/paytruth-wip/qa-logs/ui-screens-ce15926-official-verify/`. Log: `/workspace/paytruth-wip/qa-logs/main-ce15926-playwright-official-verify.log`. There is still **no public hosted demo URL**.

---

## 3. Test suites against main `ce15926`

### 3a. Program LiteSVM suite — **PASS** (60 passed / 0 failed / 0 ignored)

```
anchor build --ignore-keys    # BUILD_EXIT:0
cargo test -p paytruth -- --test-threads=4
# CARGO_TEST_EXIT:0
```

- Log: `/workspace/paytruth-wip/qa-logs/main-ce15926-program-suite.log`
- Window: 2026-11-27 14:24:21–14:27:32 WAT
- rustc 1.89.0. 49 test binaries; summed `test result:` lines = 60/0/0.

### 3b. Adversarial TS suite — **PASS** (44 passing / 0 failing)

`tests/adversarial/` on main is only `.gitkeep`. Suite overlaid from `qa/tests` `1cd924096a6f95390fc6bfed01dd11d83109d6d9` in git-less `/workspace/paytruth-wip/tmp-main-adversarial` (this SHA’s program sources). Main was not modified.

```
anchor test --validator legacy --script adversarial
# ADVERSARIAL_EXIT:0
#   44 passing (2m)
```

- Log: `/workspace/paytruth-wip/qa-logs/main-ce15926-adversarial.log` (14:28:05–14:32:26 WAT)
- Coverage includes A1–A25, X1–X16, X13, X14 / X14b (`InvoiceMismatch`). Local validator only.

---

## 4. Frontend / UI write flow

**Public live URL: not found** (README, env, docs, team notes). `gh` is not authenticated, so GitHub Pages/deployments could not be queried. App was run locally from this SHA against devnet.

The official UI e2e path is `app/playwright.devnet.config.ts`, which starts the **production** real-SDK build (`npm run start -- --port 3297`), not `pnpm dev`. That is what was used (supported, deterministic). Wallet-adapter signing **was** automated: `app/tests/devnet/test-wallet.ts` installs a Wallet Standard test wallet and signs in Node via `page.exposeFunction`. Key dir was `PAYTRUTH_UI_E2E_KEYDIR=/workspace/fs-notes/devnet-keys` (same funded files; not copied into the repo).

### 4a. Write-flow Playwright — **PASS** (3 passed / 0 failed)

```
PAYTRUTH_UI_E2E_KEYDIR=/workspace/fs-notes/devnet-keys \
npx playwright test -c playwright.devnet.config.ts --grep "devnet: full UI flow"
# 3 passed (2.8m)
# PLAYWRIGHT_EXIT:0
# 14:45:20–14:48:09 WAT
```

Log (secret-scanned): `/workspace/paytruth-wip/qa-logs/main-ce15926-playwright-write.log`  
Records + screenshots (worktree `ui-screens/` was restored after copy): `/workspace/paytruth-wip/qa-logs/ui-screens-ce15926-write/`

| UI step | PDA | Result | Signature / notes |
|---------|-----|--------|-------------------|
| create A | `EqSU8WMmSgJJuarxqd2WStS3J1qnWLSqzPzrZDzoCYzy` | ok | [`4poF88fq…erWq2`](https://explorer.solana.com/tx/4poF88fqQv2DcA47vEJrZJAogaUXoHgtLV9vYgpSMKccRFnbMPW3mxM6VKtYn1HCh5XREmCPY8ZYCV8LmK2erWq2?cluster=devnet) |
| pay exact A | same | ok | [`bnJkiR1k…aDrM`](https://explorer.solana.com/tx/bnJkiR1kA75LFw1Rei8vnXUh8BBkk9dCNoQckbTDYPo9Yk1WQajooTcdYWbYGw7Ko7oVq1JZW8JD9VRcuKMaDrM?cluster=devnet) |
| duplicate pay A blocked in UI (no pay button) | same | ok | (UI-only; no second pay tx) |
| claim A | same | ok | [`23wrVct6…qimT`](https://explorer.solana.com/tx/23wrVct6ox1BEWSKRPc2tYEoPQtRe9jteFXtUTgxyMV5N1GdynRGuak3dtn9j399vCGgZQzrjsNVd3bq4XcWqimT?cluster=devnet) |
| close A (after claim) | same | ok | [`2hRjtkUu…GixK`](https://explorer.solana.com/tx/2hRjtkUuZw29ZUjmkPtAjnSE2c7LbhTDniVi26rsSEALQB1NXNCAhNP2XTajdLNLKKnQz4eT43iWcQfxj6soGixK?cluster=devnet) |
| pay-after-close A: closed copy, no pay button | same | ok | |
| `/verify` A Paid & claimed (before close, in test) | same | ok | screenshots `verify-ui-a-devnet-*` |
| create B | `yepgwiRrgzLzQkxgGgnNsWbeSZKFcbZze8YMNApVxjY` | ok | [`4SBDi5hn…nqp81`](https://explorer.solana.com/tx/4SBDi5hnFmU9DA6WpMhcXz6UNs1LhuPCTsUuNCjC6VPxhqvbaC4ecgA4TNWCxp5zFCeVZcL5sNjcjHvYHisnqp81?cluster=devnet) |
| overpay B 1.50 for 1.00 | same | ok | [`4yhFxv8p…hJm8`](https://explorer.solana.com/tx/4yhFxv8pt1BvqmF8jM4GweyHWHriYFy7dYCi7BaJZsrZg3eP4zFJfkWAVKpCRMTvMCGvfusbfuYCDx4UrMSdhJm8?cluster=devnet) |
| refund B excess 0.50 | same | ok | [`5b1K8RvL…CxLN`](https://explorer.solana.com/tx/5b1K8RvLryg6rwK3o4xFfi6GuHkkNmyzn2ttRV16kbXLikD2zd6Q7A7S4e5h6d7tNyTkLqM8EBUjtYFEKy5kCxLN?cluster=devnet) |
| create C (short expiry) | `CT6w5DgJ6iBidXr1nNQfjJ4SNgeang1MTgBYGudfdqA1` | ok | [`3EUa4k1g…qHK5`](https://explorer.solana.com/tx/3EUa4k1gVjR3hLujMFvqq1DBVRprGdWuxXXFARGxmQKDeGguRVKhpY5SWCkXZbVT53cWXdJGWZCrM5M16oVCqHK5?cluster=devnet) |
| pay C expired: UI shows expired, no pay button | same | ok | (UI-only after wait) |
| expire C | same | ok | [`3gpE82xu…cTRt`](https://explorer.solana.com/tx/3gpE82xuFbGnkmupQ5GYaqSc3PwrcYovVgXufpTRRPxym4jKfjpuqciXSagNjt6kHzvARyNfHBcSbpSr9A9HcTRt?cluster=devnet) |
| close C | same | ok | [`4KG3CiiK…xA7y`](https://explorer.solana.com/tx/4KG3CiiK5azcLNf7G73QdBH1dyKZ1ULPfY78SuaaVJL9A1eEb8nfUZc54n8gfd692tttqDRVvZ537B6KCeWUxA7y?cluster=devnet) |
| pay-after-close C + `/verify` Closed | same | ok | |

No UI write-flow step was skipped for signing reasons.

### 4b. Earlier read-only check (before funding was unblocked)

Local Playwright read-only verify of *older* FS invoices A/B/C: 1 passed (8.3s). Log: `/workspace/paytruth-wip/qa-logs/main-ce15926-playwright-readonly.log`. That is not this pass’s official invoices.

---

## 5. `git push origin qa/tests`

Earlier retry in this QA window failed with exit 128 (`could not read Username for 'https://github.com': No such device or address`). A later read-only `git ls-remote` showed origin already at `1cd924096a6f95390fc6bfed01dd11d83109d6d9` (in sync). This session did not push. The Lead handles the qa/tests PR. Main was not pushed.

A local branch `qa/final-ce15926` is used to commit this report in the paytruth repo (see below); it is not a push of main.

---

## 6. Blockers and notes

1. **No remaining blocker for the official 7-step devnet demo or the local UI write flow** on this SHA, once the funded demo keypairs were authorised.
2. **No public live demo URL** yet — observer verify was done on a local real-SDK app pointed at devnet.
3. **`tests/adversarial` is not on main** (only `.gitkeep`). 44/44 used a qa/tests overlay in a temp tree.
4. Root `README.md` on this merge still looks like the early scaffold. Honest-disclosure review (Q6) is still outstanding.
5. GitHub push auth is still missing in this shell (`gh` logged out). Local commits only.
6. First airdrop-only attempt was blocked; that is historical, not the current verdict.

---

## Log index

| Log | Path |
|-----|------|
| Official `devnet:demo` (funded, this verdict) | `/workspace/paytruth-wip/qa-logs/main-ce15926-devnet-demo.log` |
| Official runner JSON/MD copy | `/workspace/paytruth-wip/qa-logs/devnet-demo-ce15926/` |
| Unfunded first attempt | `/workspace/paytruth-wip/qa-logs/main-ce15926-devnet-demo-unfunded.log` |
| Program LiteSVM suite | `/workspace/paytruth-wip/qa-logs/main-ce15926-program-suite.log` |
| Adversarial TS suite | `/workspace/paytruth-wip/qa-logs/main-ce15926-adversarial.log` |
| App production build | `/workspace/paytruth-wip/qa-logs/main-ce15926-app-build.log` |
| Playwright write-flow | `/workspace/paytruth-wip/qa-logs/main-ce15926-playwright-write.log` |
| Playwright official `/verify` | `/workspace/paytruth-wip/qa-logs/main-ce15926-playwright-official-verify.log` |
| Write-flow shots + `devnet-run.json` | `/workspace/paytruth-wip/qa-logs/ui-screens-ce15926-write/` |
| Official invoice verify shots | `/workspace/paytruth-wip/qa-logs/ui-screens-ce15926-official-verify/` |
