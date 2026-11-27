# Paytruth Interfaces

## Artifacts

| Artifact | Path | Owner |
|---|---|---|
| IDL | `target/idl/paytruth.json` | Anchor Engineer (commits after every program change) |
| TS types | `target/types/paytruth.ts` | Anchor Engineer (commits after every program change) |
| Deploy record | `programs/DEPLOYMENTS.md` | Anchor Engineer (cluster, program id, config PDA, usdc mint used, deploy tx, slot/time WAT) |

`programs/DEPLOYMENTS.md` must record, per cluster: program id, config PDA, USDC mint used (Circle devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` or fallback test mint), deploy tx signature, slot, and wall-clock time in WAT.

## TS client SDK (Full-Stack owns; UI consumes)

No bodies below — signatures only. Canonical module: `sdk/**` (or `app/lib/paytruth/**`).

```ts
// PDA derivation
getInvoicePda(merchant: PublicKey, invoiceId: bigint): [PublicKey, number];
getConfigPda(): [PublicKey, number];
getEscrowAta(invoicePda: PublicKey, mint: PublicKey): PublicKey;

// Reads
fetchConfig(commitment?: Commitment): Promise<Config>;
fetchInvoice(invoicePda: PublicKey, commitment?: Commitment): Promise<Invoice>;
fetchInvoiceByMerchantAndId(merchant: PublicKey, invoiceId: bigint, commitment?: Commitment): Promise<Invoice>;
fetchEscrowBalance(invoicePda: PublicKey, mint: PublicKey): Promise<bigint>;

// Writes (return confirmed signature; caller polls state)
initializeConfig(args: { usdcMint: PublicKey }): Promise<{ signature: string; configPda: PublicKey }>;
createInvoice(args: { invoiceId: bigint; amountDue: bigint; expiresAt: bigint; memo: string | Uint8Array }): Promise<{ signature: string; invoicePda: PublicKey }>;
payInvoice(args: { invoicePda: PublicKey; amount: bigint }): Promise<{ signature: string }>;
merchantClaim(args: { invoicePda: PublicKey }): Promise<{ signature: string }>;
refundOverpayment(args: { invoicePda: PublicKey }): Promise<{ signature: string }>;
expireInvoice(args: { invoicePda: PublicKey }): Promise<{ signature: string }>;
recoverUnattributed(args: { invoicePda: PublicKey; destinationAta: PublicKey }): Promise<{ signature: string }>;
closeInvoice(args: { invoicePda: PublicKey }): Promise<{ signature: string }>;

// State helpers
waitForInvoiceState(invoicePda: PublicKey, predicate: (inv: Invoice) => boolean, opts?: { commitment?: Commitment; timeoutMs?: number }): Promise<Invoice>;
subscribeInvoice(invoicePda: PublicKey, cb: (inv: Invoice | null) => void): () => void;
```

### Types

```ts
type Commitment = "processed" | "confirmed" | "finalized"; // default "confirmed"

enum InvoiceStatus { Open = 0, Paid = 1, Expired = 2 }

interface Config {
  authority: PublicKey;
  usdcMint: PublicKey;
  bump: number;
}

interface Invoice {
  merchant: PublicKey;
  payer: PublicKey;          // PublicKey.default() until paid
  mint: PublicKey;
  invoiceId: bigint;
  amountDue: bigint;
  paidAmount: bigint;
  refundedExcess: bigint;
  createdAt: bigint;
  expiresAt: bigint;
  status: InvoiceStatus;
  claimed: boolean;
  bump: number;
  memo: Uint8Array;          // 64 bytes, zero-padded
}
```

SDK `createInvoice` accepts a UTF-8 `string` or a `Uint8Array` and zero-pads or rejects if longer than 64 bytes (do not silently truncate a merchant memo).

`initializeConfig` is for deploy/localnet setup (Anchor Engineer at deploy); the UI does not call it in the demo.

Client behaviour (implement in SDK, not UI):
- Submit at `confirmed`; poll the Invoice **account** (not just the signature) until expected state; merchant irreversible actions wait `finalized`.
- On send timeout: refetch the Invoice account at `confirmed` then `finalized` before resubmitting. Rebuild+resign only when on-chain state shows the prior tx did not land. Program rejects duplicates (`DuplicatePayment`).

## Hooks (Full-Stack)

```ts
useInvoice(invoicePda: PublicKey, opts?: { commitment?: Commitment }): { invoice: Invoice | null; escrowBalance: bigint | null; loading: boolean; error: Error | null };
```

UI is presentational and consumes SDK/hooks only.

## Public verify route

`/verify/[invoicePda]` — reads chain directly (no backend declaration of success).

| Aspect | Rule |
|---|---|
| Source | `fetchInvoice` + `fetchEscrowBalance` (or `useInvoice`) |
| Badge | Paid/Claimed only from `finalized` Invoice state; show "confirming…" when only `confirmed` |
| Shows | status, merchant, payer (if recorded), amount_due, paid_amount, excess, claimed, refunded_excess, expires_at, memo, escrow balance, commitment used |
| Observer | works with no wallet and no merchant/payer signature |

## Read-only API/indexer (optional, not built in v1)

Frontend reads RPC directly. If an indexer is added it may only read accounts/events and must never expose a "mark paid" endpoint; the verify page must still read the Invoice account itself.

## File ownership

| Owner | Files |
|---|---|
| Anchor Engineer | `programs/paytruth/**`, `tests/program/**`; commits `target/idl/paytruth.json`, `target/types/paytruth.ts`; updates `programs/DEPLOYMENTS.md` after deploy |
| Full-Stack Engineer | `sdk/**` (or `app/lib/paytruth/**`), wallet provider, hooks, read-only API/indexer routes; never a "mark paid" endpoint |
| UI/UX Engineer | `app/components/ui/**`, `app/styles/**`, tailwind, presentational layouts, verify page chrome; consumes SDK/hooks only |
| QA/Security | `tests/adversarial/**`, `tests/e2e/**`, security review write-up; no program logic change without PR review |
| Team Lead | repo, branch protection, PR merges, README, submission, these docs, judging strategy |

## Branches

`feat/program`, `feat/client`, `feat/ui`, `qa/tests`. `main` protected; no direct/force push; merges by Team Lead only.
