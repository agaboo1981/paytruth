mod common;

use common::*;

#[test]
fn h8_expire_at_expires_at() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, _escrow, _bump) = do_create_invoice(
        &mut svm,
        &merchant,
        &config,
        80,
        1000,
        expiry,
        [0u8; 64],
        &mint,
    );

    // Before expiry: expire fails NotExpired.
    warp_to(&mut svm, expiry - 1);
    let res = send(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    assert_custom_error(res, &program_id(), 6008);
    assert_eq!(read_invoice(&svm, &invoice).status, 0, "state unchanged");

    // Exactly at expires_at: expire succeeds.
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    assert_eq!(read_invoice(&svm, &invoice).status, 2);
}
