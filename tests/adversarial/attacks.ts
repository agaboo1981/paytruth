import { BN, web3 } from "@anchor-lang/core";
import { expect } from "chai";
import {
  AMOUNT_DUE,
  BalanceSnapshot,
  ErrorExpectation,
  InvoiceFixture,
  OVERPAY_AMOUNT,
  STRAY_AMOUNT,
  TestContext,
  assertBalancesUnchanged,
  assertInvoiceExists,
  assertInvoiceGone,
  assertInvoiceUnchanged,
  claimTx,
  closeTx,
  configSnapshot,
  createAta,
  createDecoyEscrow,
  createFakeEscrowWithInvoiceAuthority,
  createOpenInvoice,
  createShortLivedInvoice,
  createToken2022MintAndAta,
  describeAdversarial,
  escrowAtaFor,
  expectTxFail,
  expireTx,
  fetchConfig,
  fetchInvoice,
  fetchInvoiceNullable,
  invoicePdaFor,
  invoiceSnapshot,
  makeCreateInvoiceTx,
  nextInvoiceId,
  nowUnix,
  payTx,
  refundTx,
  recoverTx,
  setupSuite,
  snapshotBalances,
  standardAccounts,
  tokenAmount,
  transferToken,
  warpToUnixTimestamp,
} from "./helpers";

const ACCOUNT_IN_USE: ErrorExpectation = [
  /already in use/i,
  "AccountAlreadyInUse",
  "ConstraintSeeds",
];
const MINT_ERRORS: ErrorExpectation = [
  "InvalidMint",
  "ConfigMintMismatch",
  "ConstraintHasOne",
  "ConstraintSeeds",
  /token program/i,
];
const ESCROW_ERRORS: ErrorExpectation = [
  "InvalidEscrow",
  "ConstraintHasOne",
  "ConstraintSeeds",
  /associated token|token account|owner does not match/i,
];
const MERCHANT_ERRORS: ErrorExpectation = [
  "UnauthorizedMerchant",
  "ConstraintHasOne",
  /signature verification|missing signature/i,
];
const PAYER_ATA_ERRORS: ErrorExpectation = [
  "InvalidPayerAta",
  "ConstraintHasOne",
  "ConstraintSeeds",
  /associated token|owner does not match/i,
];
const TOKEN_PROGRAM_ERRORS: ErrorExpectation = [
  "InvalidMint",
  "InvalidEscrow",
  "ConstraintHasOne",
  /token program|incorrect program id|invalid account data|ProgramFailedToComplete/i,
];
const SEEDS_ERRORS: ErrorExpectation = [
  "ConstraintSeeds",
  /seeds|constraint|associated token/i,
];

interface Baseline {
  invoice: string;
  balances: BalanceSnapshot;
  accounts: Record<string, web3.PublicKey>;
}

describeAdversarial("Paytruth adversarial rejection suite", () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await setupSuite();
  });

  async function baseline(
    invoice: InvoiceFixture,
    extras: Record<string, web3.PublicKey> = {}
  ): Promise<Baseline> {
    return {
      invoice: invoiceSnapshot(await fetchInvoice(ctx, invoice.pda)),
      balances: await snapshotBalances(
        ctx,
        standardAccounts(ctx, invoice.escrow, extras)
      ),
      accounts: standardAccounts(ctx, invoice.escrow, extras),
    };
  }

  async function assertUnchanged(
    invoice: InvoiceFixture,
    before: Baseline
  ): Promise<void> {
    await assertInvoiceUnchanged(ctx, invoice.pda, before.invoice);
    assertBalancesUnchanged(
      before.balances,
      await snapshotBalances(ctx, before.accounts)
    );
  }

  async function expectRejected(
    invoice: InvoiceFixture,
    before: Baseline,
    promise: () => Promise<unknown>,
    expected: ErrorExpectation
  ): Promise<void> {
    await expectTxFail(promise, expected);
    await assertUnchanged(invoice, before);
  }

  async function expectCreateRejected(
    pda: web3.PublicKey,
    escrow: web3.PublicKey,
    promise: () => Promise<unknown>,
    expected: ErrorExpectation
  ): Promise<void> {
    const accounts = standardAccounts(ctx, escrow);
    const before = await snapshotBalances(ctx, accounts);
    await expectTxFail(promise, expected);
    expect(await fetchInvoiceNullable(ctx, pda)).to.equal(null);
    assertBalancesUnchanged(before, await snapshotBalances(ctx, accounts));
  }

  async function paidFixture(
    amount: BN = OVERPAY_AMOUNT
  ): Promise<InvoiceFixture> {
    const invoice = await createOpenInvoice(ctx);
    await payTx(ctx, invoice, amount).rpc();
    return invoice;
  }

  async function expiredFixture(
    stray: BN = new BN(0)
  ): Promise<InvoiceFixture> {
    const invoice = await createShortLivedInvoice(ctx);
    if (!stray.isZero()) {
      await transferToken(
        ctx,
        stray,
        ctx.wallets.payer,
        ctx.atas.payer,
        invoice.escrow
      );
    }
    await warpToUnixTimestamp(ctx, invoice.expiresAt);
    await expireTx(ctx, invoice).rpc();
    return invoice;
  }

  describe("A — TEST-PLAN attacks", () => {
    it("A1 double pay is rejected with DuplicatePayment and no transfer", async () => {
      const invoice = await paidFixture(AMOUNT_DUE);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => payTx(ctx, invoice, invoice.amountDue).rpc(),
        ["DuplicatePayment"]
      );
    });

    it("A2 merchant_claim twice is rejected with AlreadyClaimed", async () => {
      const invoice = await paidFixture();
      await claimTx(ctx, invoice).rpc();
      const before = await baseline(invoice);
      await expectRejected(invoice, before, () => claimTx(ctx, invoice).rpc(), [
        "AlreadyClaimed",
      ]);
    });

    it("A3 merchant_claim on an Open invoice is rejected with InvoiceNotPaid", async () => {
      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice);
      await expectRejected(invoice, before, () => claimTx(ctx, invoice).rpc(), [
        "InvoiceNotPaid",
      ]);
    });

    it("A4 merchant_claim is capped at amount_due and leaves overpay in the vault", async () => {
      const invoice = await paidFixture();
      const before = await baseline(invoice);
      await claimTx(ctx, invoice).rpc();
      const after = await baseline(invoice);

      expect(
        bnDiff(after.balances.merchant, before.balances.merchant).toString()
      ).to.equal(invoice.amountDue.toString());
      expect(after.balances.escrow).to.equal(
        OVERPAY_AMOUNT.sub(invoice.amountDue).toString()
      );
      expect(after.balances.payer).to.equal(before.balances.payer);
      const account = await fetchInvoice(ctx, invoice.pda);
      expect(account.claimed).to.equal(true);
      expect(statusOf(account)).to.equal("Paid");
      expect(String(account.paidAmount ?? account.paid_amount)).to.equal(
        OVERPAY_AMOUNT.toString()
      );
      expect(
        String(account.refundedExcess ?? account.refunded_excess)
      ).to.equal("0");
    });

    it("A5 refund to an ATA not owned by the recorded payer is rejected", async () => {
      const invoice = await paidFixture();
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => refundTx(ctx, invoice, { payerAta: ctx.atas.attacker }).rpc(),
        PAYER_ATA_ERRORS
      );
    });

    it("A6 refund twice is rejected with AlreadyRefunded", async () => {
      const invoice = await paidFixture();
      await refundTx(ctx, invoice).rpc();
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => refundTx(ctx, invoice).rpc(),
        ["AlreadyRefunded"]
      );
    });

    it("A7 pay after expiry without expire_invoice is rejected with InvoiceExpired", async () => {
      const invoice = await createShortLivedInvoice(ctx);
      await warpToUnixTimestamp(ctx, invoice.expiresAt);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => payTx(ctx, invoice, invoice.amountDue).rpc(),
        ["InvoiceExpired"]
      );
    });

    it("A8 expire_invoice before expiry is rejected with NotExpired", async () => {
      const invoice = await createOpenInvoice(ctx, {
        expiresAt: (await nowUnix(ctx)).add(new BN(3600)),
      });
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => expireTx(ctx, invoice).rpc(),
        ["NotExpired"]
      );
    });

    it("A9 expire_invoice on a Paid invoice is rejected with InvoiceNotOpen", async () => {
      const invoice = await paidFixture(AMOUNT_DUE);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => expireTx(ctx, invoice).rpc(),
        ["InvoiceNotOpen"]
      );
    });

    it("A10 wrong mint on create and on pay is rejected", async () => {
      const createId = nextInvoiceId();
      const [wrongPda] = invoicePdaFor(
        ctx.wallets.merchant.publicKey,
        createId,
        ctx.program.programId
      );
      const wrongEscrow = escrowAtaFor(wrongPda, ctx.altMint);
      const badCreate = makeCreateInvoiceTx(ctx, {
        id: createId,
        mint: ctx.altMint,
        escrow: wrongEscrow,
      });
      await expectCreateRejected(
        wrongPda,
        wrongEscrow,
        () => badCreate.tx.rpc(),
        MINT_ERRORS
      );

      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice, {
        payerAlt: ctx.atas.payerAlt,
        escrowAlt: escrowAtaFor(invoice.pda, ctx.altMint),
      });
      await expectRejected(
        invoice,
        before,
        () =>
          payTx(ctx, invoice, invoice.amountDue, {
            mint: ctx.altMint,
            payerAta: ctx.atas.payerAlt,
          }).rpc(),
        MINT_ERRORS
      );
    });

    it("A11 fake escrow with wrong authority and non-ATA escrow are rejected", async () => {
      const invoice = await createOpenInvoice(ctx);
      const wrongAuthority = await baseline(invoice);
      await expectRejected(
        invoice,
        wrongAuthority,
        () =>
          payTx(ctx, invoice, invoice.amountDue, {
            escrow: ctx.atas.merchant,
          }).rpc(),
        ESCROW_ERRORS
      );

      const fakeEscrow = await createFakeEscrowWithInvoiceAuthority(
        ctx,
        invoice
      );
      const nonAta = await baseline(invoice, { fakeEscrow });
      await expectRejected(
        invoice,
        nonAta,
        () =>
          payTx(ctx, invoice, invoice.amountDue, { escrow: fakeEscrow }).rpc(),
        ESCROW_ERRORS
      );
    });

    it("A12a wrong merchant signer on claim, recover and close is rejected", async () => {
      const paid = await paidFixture(AMOUNT_DUE);
      const claimBefore = await baseline(paid);
      await expectRejected(
        paid,
        claimBefore,
        () => claimTx(ctx, paid, { merchant: ctx.wallets.altMerchant }).rpc(),
        MERCHANT_ERRORS
      );

      const expiredWithStray = await expiredFixture(STRAY_AMOUNT);
      const recoverBefore = await baseline(expiredWithStray);
      await expectRejected(
        expiredWithStray,
        recoverBefore,
        () =>
          recoverTx(ctx, expiredWithStray, {
            merchant: ctx.wallets.altMerchant,
          }).rpc(),
        MERCHANT_ERRORS
      );

      const expired = await expiredFixture();
      const closeBefore = await baseline(expired);
      await expectRejected(
        expired,
        closeBefore,
        () =>
          closeTx(ctx, expired, { merchant: ctx.wallets.altMerchant }).rpc(),
        MERCHANT_ERRORS
      );
    });

    it("A12b create_invoice with PDA seeds of another merchant is rejected", async () => {
      const id = nextInvoiceId();
      const [wrongPda] = invoicePdaFor(
        ctx.wallets.altMerchant.publicKey,
        id,
        ctx.program.programId
      );
      const wrongEscrow = escrowAtaFor(wrongPda, ctx.mint);
      const badCreate = makeCreateInvoiceTx(ctx, {
        id,
        invoice: wrongPda,
        escrow: wrongEscrow,
      });
      await expectCreateRejected(
        wrongPda,
        wrongEscrow,
        () => badCreate.tx.rpc(),
        SEEDS_ERRORS
      );
    });

    it("A13a reinit while an Invoice exists is rejected", async () => {
      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice);
      const reinit = makeCreateInvoiceTx(ctx, { id: invoice.id });
      await expectRejected(
        invoice,
        before,
        () => reinit.tx.rpc(),
        ACCOUNT_IN_USE
      );
    });

    it("A13b close then recreate the same invoice_id yields a fresh Open invoice", async () => {
      const id = nextInvoiceId();
      const invoice = await createOpenInvoice(ctx, { id });
      await payTx(ctx, invoice, invoice.amountDue).rpc();
      await claimTx(ctx, invoice).rpc();
      await closeTx(ctx, invoice).rpc();
      await assertInvoiceGone(ctx, invoice.pda);

      const recreated = await createOpenInvoice(ctx, { id });
      const account = await fetchInvoice(ctx, recreated.pda);
      expect(String(account.invoiceId ?? account.invoice_id)).to.equal(
        id.toString()
      );
      expect(statusOf(account)).to.equal("Open");
      expect(String(account.paidAmount ?? account.paid_amount)).to.equal("0");
      expect(
        String(account.refundedExcess ?? account.refunded_excess)
      ).to.equal("0");
      expect(String(account.merchant)).to.equal(
        ctx.wallets.merchant.publicKey.toString()
      );
      expect(String(account.payer)).to.equal(web3.PublicKey.default.toString());
      expect(account.claimed).to.equal(false);
      expect((await tokenAmount(ctx, recreated.escrow)).toString()).to.equal(
        "0"
      );
    });

    it("A14 Token-2022 mint and Token-2022 token_program are rejected on pay", async () => {
      const lookalike = await createToken2022MintAndAta(ctx, ctx.wallets.payer);
      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice, { t22PayerAta: lookalike.ata });
      await expectRejected(
        invoice,
        before,
        () =>
          payTx(ctx, invoice, invoice.amountDue, {
            mint: lookalike.mint,
            payerAta: lookalike.ata,
            tokenProgram: ctx.token2022Program,
          }).rpc(),
        MINT_ERRORS
      );
    });

    it("A15 underpayment is rejected with no transfer and no state change", async () => {
      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => payTx(ctx, invoice, invoice.amountDue.sub(new BN(1))).rpc(),
        ["Underpayment"]
      );
    });

    it("A16 zero amount on create and zero amount on pay are rejected", async () => {
      const badCreate = makeCreateInvoiceTx(ctx, { amountDue: new BN(0) });
      await expectCreateRejected(
        badCreate.fixture.pda,
        badCreate.fixture.escrow,
        () => badCreate.tx.rpc(),
        ["InvalidAmount"]
      );

      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => payTx(ctx, invoice, new BN(0)).rpc(),
        ["InvalidAmount"]
      );
    });

    it("A17 create_invoice with an expiry in the past is rejected", async () => {
      const expiresAt = (await nowUnix(ctx)).sub(new BN(1));
      const badCreate = makeCreateInvoiceTx(ctx, { expiresAt });
      await expectCreateRejected(
        badCreate.fixture.pda,
        badCreate.fixture.escrow,
        () => badCreate.tx.rpc(),
        ["InvalidExpiry"]
      );
    });

    it("A18 recover_unattributed before terminal is rejected with InvoiceNotTerminal", async () => {
      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => recoverTx(ctx, invoice).rpc(),
        ["InvoiceNotTerminal"]
      );
    });

    it("A19 recover_unattributed with excess outstanding is rejected", async () => {
      const invoice = await paidFixture();
      await claimTx(ctx, invoice).rpc();
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => recoverTx(ctx, invoice).rpc(),
        ["ExcessOutstanding"]
      );
      const after = await baseline(invoice);
      expect(after.balances.escrow).to.equal(
        OVERPAY_AMOUNT.sub(invoice.amountDue).toString()
      );
    });

    it("A20 close_invoice with a non-empty vault is rejected with VaultNotEmpty", async () => {
      const invoice = await expiredFixture(STRAY_AMOUNT);
      const before = await baseline(invoice);
      await expectRejected(invoice, before, () => closeTx(ctx, invoice).rpc(), [
        "VaultNotEmpty",
      ]);
      const after = await baseline(invoice);
      expect(after.balances.escrow).to.equal(STRAY_AMOUNT.toString());
    });

    it("A21 direct transfer into the vault preserves status and is recoverable after expiry", async () => {
      const invoice = await createShortLivedInvoice(ctx);
      await transferToken(
        ctx,
        STRAY_AMOUNT,
        ctx.wallets.payer,
        ctx.atas.payer,
        invoice.escrow
      );

      const open = await fetchInvoice(ctx, invoice.pda);
      expect(statusOf(open)).to.equal("Open");
      expect(String(open.paidAmount ?? open.paid_amount)).to.equal("0");
      expect((await tokenAmount(ctx, invoice.escrow)).toString()).to.equal(
        STRAY_AMOUNT.toString()
      );
      expect(String(open.payer)).to.equal(web3.PublicKey.default.toString());

      await warpToUnixTimestamp(ctx, invoice.expiresAt);
      await expireTx(ctx, invoice).rpc();
      const expired = await fetchInvoice(ctx, invoice.pda);
      expect(statusOf(expired)).to.equal("Expired");

      const before = await baseline(invoice);
      await recoverTx(ctx, invoice).rpc();
      const after = await baseline(invoice);
      expect(
        bnDiff(after.balances.merchant, before.balances.merchant).toString()
      ).to.equal(STRAY_AMOUNT.toString());
      expect(after.balances.escrow).to.equal("0");
      const recovered = await fetchInvoice(ctx, invoice.pda);
      expect(invoiceSnapshot(recovered)).to.equal(invoiceSnapshot(expired));
    });

    it("A22 refund_overpayment with no excess is rejected with NothingToRefund", async () => {
      const invoice = await paidFixture(AMOUNT_DUE);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => refundTx(ctx, invoice).rpc(),
        ["NothingToRefund"]
      );
    });

    it("A23 recover_unattributed on an empty vault is rejected with NothingToRecover", async () => {
      const invoice = await expiredFixture();
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => recoverTx(ctx, invoice).rpc(),
        ["NothingToRecover"]
      );
    });

    it("A24 close_invoice on an Open invoice is rejected with InvoiceNotTerminal", async () => {
      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice);
      await expectRejected(invoice, before, () => closeTx(ctx, invoice).rpc(), [
        "InvoiceNotTerminal",
      ]);
    });

    it("A25 merchant_claim on an Expired invoice is rejected with InvoiceNotPaid", async () => {
      const invoice = await expiredFixture();
      const before = await baseline(invoice);
      await expectRejected(invoice, before, () => claimTx(ctx, invoice).rpc(), [
        "InvoiceNotPaid",
      ]);
    });
  });

  describe("X — extra QA cases", () => {
    it("X1 pay at the expiry boundary now == expires_at is rejected", async () => {
      const invoice = await createShortLivedInvoice(ctx);
      await warpToUnixTimestamp(ctx, invoice.expiresAt);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => payTx(ctx, invoice, invoice.amountDue).rpc(),
        ["InvoiceExpired"]
      );
    });

    it("X2 expire_invoice at the expiry boundary succeeds", async () => {
      const invoice = await createShortLivedInvoice(ctx);
      await warpToUnixTimestamp(ctx, invoice.expiresAt);
      const before = await baseline(invoice);
      await expireTx(ctx, invoice).rpc();
      const account = await fetchInvoice(ctx, invoice.pda);
      expect(statusOf(account)).to.equal("Expired");
      assertBalancesUnchanged(
        before.balances,
        await snapshotBalances(ctx, before.accounts)
      );
      expect(await fetchInvoiceNullable(ctx, invoice.pda)).to.not.equal(null);
    });

    it("X3 a Paid invoice cannot expire after wall-clock expiry but claim and refund still work", async () => {
      const invoice = await createShortLivedInvoice(ctx, 6);
      await payTx(ctx, invoice, OVERPAY_AMOUNT).rpc();
      await warpToUnixTimestamp(ctx, invoice.expiresAt);

      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => expireTx(ctx, invoice).rpc(),
        ["InvoiceNotOpen"]
      );

      await claimTx(ctx, invoice).rpc();
      await refundTx(ctx, invoice).rpc();
      const account = await fetchInvoice(ctx, invoice.pda);
      expect(statusOf(account)).to.equal("Paid");
      expect(account.claimed).to.equal(true);
      expect(
        String(account.refundedExcess ?? account.refunded_excess)
      ).to.equal(OVERPAY_AMOUNT.sub(invoice.amountDue).toString());
      const after = await baseline(invoice);
      expect(
        bnDiff(after.balances.payer, before.balances.payer).toString()
      ).to.equal(OVERPAY_AMOUNT.sub(invoice.amountDue).toString());
    });

    it("X4 attacker-triggered refund sends excess only to the recorded payer", async () => {
      const invoice = await paidFixture();
      const before = await baseline(invoice);
      await refundTx(ctx, invoice, { caller: ctx.wallets.attacker }).rpc();
      const after = await baseline(invoice);

      expect(
        bnDiff(after.balances.payer, before.balances.payer).toString()
      ).to.equal(OVERPAY_AMOUNT.sub(invoice.amountDue).toString());
      expect(after.balances.attacker).to.equal(before.balances.attacker);
      expect(after.balances.escrow).to.equal(invoice.amountDue.toString());
      const account = await fetchInvoice(ctx, invoice.pda);
      expect(
        String(account.refundedExcess ?? account.refunded_excess)
      ).to.equal(OVERPAY_AMOUNT.sub(invoice.amountDue).toString());
    });

    it("X5 refund_overpayment on Open and on Expired is rejected with InvoiceNotPaid", async () => {
      const open = await createOpenInvoice(ctx);
      const openBefore = await baseline(open);
      await expectRejected(open, openBefore, () => refundTx(ctx, open).rpc(), [
        "InvoiceNotPaid",
      ]);

      const expired = await expiredFixture();
      const expiredBefore = await baseline(expired);
      await expectRejected(
        expired,
        expiredBefore,
        () => refundTx(ctx, expired).rpc(),
        ["InvoiceNotPaid"]
      );
    });

    it("X6 pay after expire_invoice flipped the status is rejected with DuplicatePayment", async () => {
      const invoice = await createShortLivedInvoice(ctx);
      await warpToUnixTimestamp(ctx, invoice.expiresAt);
      await expireTx(ctx, invoice).rpc();
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => payTx(ctx, invoice, invoice.amountDue).rpc(),
        ["DuplicatePayment"]
      );
    });

    it("X7 expire_invoice on an already Expired invoice is rejected", async () => {
      const invoice = await expiredFixture();
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => expireTx(ctx, invoice).rpc(),
        ["InvoiceNotOpen"]
      );
    });

    it("X8 mint mismatch on claim, refund, recover and close is rejected", async () => {
      const paid = await paidFixture();
      const claimBefore = await baseline(paid);
      await expectRejected(
        paid,
        claimBefore,
        () => claimTx(ctx, paid, { mint: ctx.altMint }).rpc(),
        MINT_ERRORS
      );

      const refundBefore = await baseline(paid);
      await expectRejected(
        paid,
        refundBefore,
        () => refundTx(ctx, paid, { mint: ctx.altMint }).rpc(),
        MINT_ERRORS
      );

      const expired = await expiredFixture(STRAY_AMOUNT);
      const recoverBefore = await baseline(expired);
      await expectRejected(
        expired,
        recoverBefore,
        () => recoverTx(ctx, expired, { mint: ctx.altMint }).rpc(),
        MINT_ERRORS
      );

      const closedCandidate = await paidFixture(AMOUNT_DUE);
      await claimTx(ctx, closedCandidate).rpc();
      const closeBefore = await baseline(closedCandidate);
      await expectRejected(
        closedCandidate,
        closeBefore,
        () => closeTx(ctx, closedCandidate, { mint: ctx.altMint }).rpc(),
        MINT_ERRORS
      );
    });

    it("X9 decoy escrow ATA for another mint is rejected by all escrow-consuming instructions", async () => {
      const paid = await paidFixture();
      const paidDecoy = await createDecoyEscrow(ctx, paid);
      const claimBefore = await baseline(paid, { decoy: paidDecoy });
      await expectRejected(
        paid,
        claimBefore,
        () => claimTx(ctx, paid, { escrow: paidDecoy }).rpc(),
        ESCROW_ERRORS
      );
      const refundBefore = await baseline(paid, { decoy: paidDecoy });
      await expectRejected(
        paid,
        refundBefore,
        () => refundTx(ctx, paid, { escrow: paidDecoy }).rpc(),
        ESCROW_ERRORS
      );

      const expired = await expiredFixture(STRAY_AMOUNT);
      const expiredDecoy = await createDecoyEscrow(ctx, expired);
      const recoverBefore = await baseline(expired, { decoy: expiredDecoy });
      await expectRejected(
        expired,
        recoverBefore,
        () => recoverTx(ctx, expired, { escrow: expiredDecoy }).rpc(),
        ESCROW_ERRORS
      );

      const closable = await expiredFixture();
      const closeDecoy = await createDecoyEscrow(ctx, closable);
      const closeBefore = await baseline(closable, { decoy: closeDecoy });
      await expectRejected(
        closable,
        closeBefore,
        () => closeTx(ctx, closable, { escrow: closeDecoy }).rpc(),
        ESCROW_ERRORS
      );

      await assertInvoiceExists(ctx, paid.pda);
      await assertInvoiceExists(ctx, expired.pda);
      await assertInvoiceExists(ctx, closable.pda);
    });

    it("X10 payer_ata owned by someone other than the payer is rejected on pay", async () => {
      const invoice = await createOpenInvoice(ctx);
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () =>
          payTx(ctx, invoice, invoice.amountDue, {
            payerAta: ctx.atas.attacker,
          }).rpc(),
        PAYER_ATA_ERRORS
      );
    });

    it("X11 Token-2022 token_program is rejected on claim, refund, recover and close", async () => {
      const paid = await paidFixture();
      const claimBefore = await baseline(paid);
      await expectRejected(
        paid,
        claimBefore,
        () => claimTx(ctx, paid, { tokenProgram: ctx.token2022Program }).rpc(),
        TOKEN_PROGRAM_ERRORS
      );

      const refundBefore = await baseline(paid);
      await expectRejected(
        paid,
        refundBefore,
        () => refundTx(ctx, paid, { tokenProgram: ctx.token2022Program }).rpc(),
        TOKEN_PROGRAM_ERRORS
      );

      const expired = await expiredFixture(STRAY_AMOUNT);
      const recoverBefore = await baseline(expired);
      await expectRejected(
        expired,
        recoverBefore,
        () =>
          recoverTx(ctx, expired, { tokenProgram: ctx.token2022Program }).rpc(),
        TOKEN_PROGRAM_ERRORS
      );

      const closable = await expiredFixture();
      const closeBefore = await baseline(closable);
      await expectRejected(
        closable,
        closeBefore,
        () =>
          closeTx(ctx, closable, { tokenProgram: ctx.token2022Program }).rpc(),
        TOKEN_PROGRAM_ERRORS
      );
    });

    it("X12 a second initialize_config is rejected and config fields stay unchanged", async () => {
      const before = configSnapshot(await fetchConfig(ctx));
      const accounts = standardAccounts(ctx, ctx.atas.payer);
      const balancesBefore = await snapshotBalances(ctx, accounts);
      await expectTxFail(
        (ctx.program.methods as any)
          .initializeConfig(ctx.mint)
          .accountsPartial({
            authority: ctx.provider.wallet.publicKey,
            config: ctx.configPda,
            usdcMint: ctx.mint,
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc(),
        ACCOUNT_IN_USE
      );
      expect(configSnapshot(await fetchConfig(ctx))).to.equal(before);
      assertBalancesUnchanged(
        balancesBefore,
        await snapshotBalances(ctx, accounts)
      );
    });

    // X13 encodes spec review S3: create_invoice must use init_if_needed on the
    // escrow ATA (never on the Invoice account). If the program still uses raw
    // `init` and this transaction fails, the pre-create griefing hole is still open.
    it("X13 create_invoice adopts a pre-created empty canonical escrow ATA", async () => {
      const id = nextInvoiceId();
      const [pda] = invoicePdaFor(
        ctx.wallets.merchant.publicKey,
        id,
        ctx.program.programId
      );
      // Spec review: create_invoice must use init_if_needed on the canonical escrow ATA only,
      // otherwise an empty pre-created ATA lets anyone DoS this invoice_id.
      const preCreatedEscrow = await createAta(ctx, ctx.mint, pda);
      const accounts = standardAccounts(ctx, preCreatedEscrow);
      const before = await snapshotBalances(ctx, accounts);

      const built = makeCreateInvoiceTx(ctx, { id, escrow: preCreatedEscrow });
      await built.tx.rpc();

      const invoice = await fetchInvoice(ctx, pda);
      expect(String(invoice.invoiceId ?? invoice.invoice_id)).to.equal(
        id.toString()
      );
      expect(statusOf(invoice)).to.equal("Open");
      expect(String(invoice.merchant)).to.equal(
        ctx.wallets.merchant.publicKey.toString()
      );
      expect(String(invoice.payer)).to.equal(web3.PublicKey.default.toString());
      expect(String(invoice.paidAmount ?? invoice.paid_amount)).to.equal("0");
      expect((await tokenAmount(ctx, preCreatedEscrow)).toString()).to.equal(
        "0"
      );
      assertBalancesUnchanged(before, await snapshotBalances(ctx, accounts));
    });

    it("X14 close then recreate with a higher amount_due makes the old pay underpay", async () => {
      // Spec review: a lower recreated amount_due would accept a stale pay as overpay unless
      // pay_invoice binds the payer's expected amount_due. No new instruction arg is invented here.
      const id = nextInvoiceId();
      const original = await createOpenInvoice(ctx, {
        id,
        amountDue: AMOUNT_DUE,
      });
      await payTx(ctx, original, original.amountDue).rpc();
      await claimTx(ctx, original).rpc();
      await closeTx(ctx, original).rpc();
      await assertInvoiceGone(ctx, original.pda);

      const increasedDue = AMOUNT_DUE.mul(new BN(2));
      const recreated = await createOpenInvoice(ctx, {
        id,
        amountDue: increasedDue,
      });
      const before = await baseline(recreated);
      await expectRejected(
        recreated,
        before,
        () => payTx(ctx, recreated, AMOUNT_DUE).rpc(),
        ["Underpayment"]
      );
    });

    it("X15 Paid+claimed+exact with stray tokens allows recover then close", async () => {
      const invoice = await paidFixture(AMOUNT_DUE);
      await claimTx(ctx, invoice).rpc();
      await transferToken(
        ctx,
        STRAY_AMOUNT,
        ctx.wallets.payer,
        ctx.atas.payer,
        invoice.escrow
      );

      const before = await baseline(invoice);
      await recoverTx(ctx, invoice).rpc();
      const afterRecover = await baseline(invoice);
      expect(
        bnDiff(
          afterRecover.balances.merchant,
          before.balances.merchant
        ).toString()
      ).to.equal(STRAY_AMOUNT.toString());
      expect(afterRecover.balances.escrow).to.equal("0");

      await closeTx(ctx, invoice).rpc();
      await assertInvoiceGone(ctx, invoice.pda);
    });

    it("X16 unclaimed Paid vault still holding amount_due cannot be recovered", async () => {
      const invoice = await paidFixture();
      await refundTx(ctx, invoice).rpc();
      const before = await baseline(invoice);
      await expectRejected(
        invoice,
        before,
        () => recoverTx(ctx, invoice).rpc(),
        ["InvoiceNotTerminal"]
      );
      const after = await baseline(invoice);
      expect(after.balances.escrow).to.equal(invoice.amountDue.toString());
      const account = await fetchInvoice(ctx, invoice.pda);
      expect(account.claimed).to.equal(false);
      expect(
        String(account.refundedExcess ?? account.refunded_excess)
      ).to.equal(OVERPAY_AMOUNT.sub(invoice.amountDue).toString());
    });
  });
});

function statusOf(account: any): string {
  const status = account?.status;
  if (status && typeof status === "object" && !BN.isBN(status)) {
    if ("open" in status) {
      return "Open";
    }
    if ("paid" in status) {
      return "Paid";
    }
    if ("expired" in status) {
      return "Expired";
    }
  }
  const text = String(status);
  if (/^0$/.test(text) || /open/i.test(text)) {
    return "Open";
  }
  if (/^1$/.test(text) || /paid/i.test(text)) {
    return "Paid";
  }
  if (/^2$/.test(text) || /expired/i.test(text)) {
    return "Expired";
  }
  return text;
}

function bnDiff(later: string, earlier: string): BN {
  return new BN(later).sub(new BN(earlier));
}
