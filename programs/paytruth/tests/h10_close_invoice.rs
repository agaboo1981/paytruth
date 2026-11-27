mod common;

use common::*;

#[test]
fn h10_close_invoice_empty_vault() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm,
        &merchant,
        &config,
        100,
        1000,
        expiry,
        [0u8; 64],
        &mint,
    );

    // Expire first so the invoice reaches a terminal state with an empty vault.
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );

    let invoice_rent = lamports(&svm, &invoice);
    let escrow_rent = lamports(&svm, &escrow);
    assert!(invoice_rent > 0 && escrow_rent > 0);
    let merchant_before = lamports(&svm, &merchant.pubkey());

    let fee = expect_ok_fee(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(&merchant.pubkey(), &invoice, &mint, &escrow, &TOKEN_PROGRAM_ID),
    );

    // Both accounts gone.
    assert!(!account_exists(&svm, &invoice), "invoice account closed");
    assert!(!account_exists(&svm, &escrow), "escrow account closed");

    // Merchant received both rent lamports, less the exact tx fee.
    let merchant_after = lamports(&svm, &merchant.pubkey());
    let rent_recovered = invoice_rent + escrow_rent;
    assert_eq!(
        merchant_after + fee,
        merchant_before + rent_recovered,
        "merchant must recover invoice+escrow rent exactly: before {merchant_before} after {merchant_after} rent {rent_recovered} fee {fee}"
    );
}
