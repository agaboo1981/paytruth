mod common;

use common::*;

#[test]
fn a20_close_with_nonempty_vault() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm,
        &merchant,
        &config,
        20,
        1000,
        expiry,
        [0u8; 64],
        &mint,
    );
    // Direct stray funds into the vault.
    mint_to(&mut svm, &authority, &mint, &mint_auth, &escrow, 400, &TOKEN_PROGRAM_ID);
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );

    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(&merchant.pubkey(), &invoice, &mint, &escrow, &TOKEN_PROGRAM_ID),
    );
    assert_custom_error(res, &program_id(), 6016);
    assert!(account_exists(&svm, &invoice), "still open");
    assert!(account_exists(&svm, &escrow), "still open");
    assert_eq!(token_balance(&svm, &escrow), 400, "vault still holds funds");
}
