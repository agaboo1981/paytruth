mod common;

use common::*;

#[test]
fn a13b_close_then_recreate_same_id_rejected() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let invoice_id = 13;
    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm,
        &merchant,
        &config,
        invoice_id,
        1000,
        expiry,
        [0xAAu8; 64],
        &mint,
    );

    // Expire + close: the escrow is gone, but the Invoice remains as a Closed tombstone.
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );
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
    assert!(!account_exists(&svm, &escrow), "escrow closed");
    assert!(account_exists(&svm, &invoice), "invoice tombstone kept");

    let before = read_invoice(&svm, &invoice);
    assert_eq!(before.status, 3, "Closed tombstone");
    let before_len = invoice_account_len(&svm, &invoice);
    assert_eq!(before_len, INVOICE_ACCOUNT_LEN);
    let before_lamports = lamports(&svm, &invoice);

    // Recreate the SAME invoice_id: the kept Invoice account breaks plain `init`, so the
    // create fails on the system program (`already in use` -> InstructionError::Custom(0)).
    let new_expiry = now(&svm) + 10_000;
    let (invoice2, bump2) = invoice_pda(&merchant.pubkey(), invoice_id);
    assert_eq!(invoice2, invoice, "same PDA");
    let escrow2 = escrow_ata(&invoice2, &mint);
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        create_invoice_ix(
            &merchant.pubkey(),
            &config,
            &invoice2,
            &mint,
            &escrow2,
            &TOKEN_PROGRAM_ID,
            &CreateInvoiceArgs {
                invoice_id,
                amount_due: 2_000,
                expires_at: new_expiry,
                memo: [0xBBu8; 64],
            },
        ),
    );
    let _ = bump2;
    assert_custom_error(res, &program_id(), 0);

    // The tombstone is completely unchanged (status, terms, memo, length, rent).
    let after = read_invoice(&svm, &invoice);
    assert_eq!(after.status, 3, "still Closed tombstone");
    assert_eq!(after.amount_due, before.amount_due);
    assert_eq!(after.amount_due, 1000, "recreate did not overwrite terms");
    assert_eq!(after.invoice_id, invoice_id);
    assert_eq!(after.memo, [0xAAu8; 64], "recreate did not overwrite memo");
    assert_eq!(after.payer, before.payer);
    assert_eq!(after.paid_amount, before.paid_amount);
    assert_eq!(invoice_account_len(&svm, &invoice), before_len);
    assert_eq!(lamports(&svm, &invoice), before_lamports);

    // The escrow is not re-created either.
    assert!(!account_exists(&svm, &escrow2), "escrow not re-created");
}
