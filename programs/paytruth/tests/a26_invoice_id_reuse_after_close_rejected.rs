mod common;

use common::*;
use solana_message::Message;
use solana_transaction::Transaction;

/// QA A26: a pay tx signed (but never sent) before the invoice expires must, after the
/// invoice has been expired + closed (tombstone), be rejected as DuplicatePayment 6001 and
/// move nothing. Reusing the same invoice_id is impossible (Custom(0) on the system init).
#[test]
fn a26_invoice_id_reuse_after_close_rejected() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let invoice_id = 1;
    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm, &merchant, &config, invoice_id, 1000, expiry, [0u8; 64], &mint,
    );
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(
        &mut svm,
        &payer,
        &mint,
        &mint_auth,
        &payer_ata,
        5_000,
        &TOKEN_PROGRAM_ID,
    );

    // Build AND SIGN a pay tx now, but do NOT send it. Capture the blockhash current at
    // signing time so we can rebuild an identically-signed tx if LiteSVM needs a fresh one.
    let pay_ix = pay_invoice_ix(
        &payer.pubkey(),
        &config,
        &invoice,
        &mint,
        &payer_ata,
        &escrow,
        &TOKEN_PROGRAM_ID,
        1000,
        1000,
    );
    let sign_blockhash = svm.latest_blockhash();
    let signed_msg = Message::new(&[pay_ix.clone()], Some(&payer.pubkey()));
    let stale_tx = Transaction::new(&[&payer], signed_msg, sign_blockhash);
    // Sanity: the tx carries the payer's signature over the intended instruction.
    assert_eq!(stale_tx.message.recent_blockhash, sign_blockhash);

    // The invoice expires.
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    assert_eq!(read_invoice(&svm, &invoice).status, 2);

    // Merchant closes the expired invoice -> tombstone.
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert!(account_exists(&svm, &invoice), "tombstone kept");
    assert!(!account_exists(&svm, &escrow), "escrow closed");
    assert_eq!(read_invoice(&svm, &invoice).status, 3);

    // Reusing invoice_id=1 with a new amount is rejected at the system `init` (Custom(0)).
    let new_expiry = now(&svm) + 10_000;
    let (reused_pda, _rb) = invoice_pda(&merchant.pubkey(), invoice_id);
    assert_eq!(reused_pda, invoice);
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        create_invoice_ix(
            &merchant.pubkey(),
            &config,
            &reused_pda,
            &mint,
            &escrow_ata(&reused_pda, &mint),
            &TOKEN_PROGRAM_ID,
            &CreateInvoiceArgs {
                invoice_id,
                amount_due: 500,
                expires_at: new_expiry,
                memo: [0u8; 64],
            },
        ),
    );
    assert_custom_error(res, &program_id(), 0);

    // PayInvoice deserializes `escrow: Account<TokenAccount>` before the handler's status
    // check, so the escrow must exist. The tombstone's escrow is gone; a third party can
    // re-create the canonical empty escrow ATA (status check still fires first in the handler).
    let stranger = funded_keypair(&mut svm);
    let recreated = create_ata(&mut svm, &stranger, &invoice, &mint, &TOKEN_PROGRAM_ID);
    assert_eq!(recreated, escrow, "same canonical escrow ATA");
    assert_eq!(token_balance(&svm, &escrow), 0);

    // Send the stale signed pay tx. If LiteSVM rejects it as BlockhashNotFound (only the
    // latest blockhash is accepted), rebuild an equally-signed tx with the same args and
    // the freshly-fetched blockhash; the program-level outcome must be identical.
    let payer_bal_before = token_balance(&svm, &payer_ata);
    let res = svm.send_transaction(stale_tx);
    let stale_result = match res {
        Ok(_) => Ok(()),
        Err(failed) => Err((failed.err, failed.meta.logs)),
    };
    let final_result = match stale_result {
        Ok(()) => panic!("stale pay tx must not succeed on a Closed invoice"),
        Err((solana_transaction_error::TransactionError::BlockhashNotFound, _)) => {
            send(&mut svm, &payer, &[&payer], pay_ix)
        }
        Err(other) => Err(other),
    };
    assert_custom_error(final_result, &program_id(), 6001);

    // Nothing changed: tombstone intact, payer and vault untouched.
    assert_eq!(token_balance(&svm, &payer_ata), payer_bal_before);
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
    assert_eq!(read_invoice(&svm, &invoice).status, 3);
    assert_eq!(read_invoice(&svm, &invoice).paid_amount, 0);
    assert_eq!(
        token_balance(&svm, &escrow),
        0,
        "re-created escrow untouched"
    );
}
