mod common;

use common::*;

#[test]
fn a13b_close_then_recreate_same_id() {
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

    // Expire + close so the PDA is freed.
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
        close_invoice_ix(&merchant.pubkey(), &invoice, &mint, &escrow, &TOKEN_PROGRAM_ID),
    );
    assert!(!account_exists(&svm, &invoice));

    // Recreate the SAME invoice_id; should succeed as a fresh Open invoice.
    let new_expiry = now(&svm) + 10_000;
    let (invoice2, escrow2, _bump2) = do_create_invoice(
        &mut svm,
        &merchant,
        &config,
        invoice_id,
        2_000,
        new_expiry,
        [0xBBu8; 64],
        &mint,
    );
    assert_eq!(invoice2, invoice, "same PDA");
    assert_eq!(escrow2, escrow, "same escrow ATA PDA");

    let inv = read_invoice(&svm, &invoice2);
    assert_eq!(inv.status, 0, "fresh Open invoice");
    assert_eq!(inv.amount_due, 2_000);
    assert_eq!(inv.payer, Pubkey::default());
    assert_eq!(inv.paid_amount, 0);
    assert_eq!(inv.claimed, false);
    assert_eq!(inv.memo, [0xBBu8; 64]);
    assert_eq!(token_balance(&svm, &escrow2), 0);
}
