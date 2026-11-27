mod common;

use common::*;

#[test]
fn h9_recover_unattributed_expired_stray_funds() {
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
        90,
        1000,
        expiry,
        [0u8; 64],
        &mint,
    );

    // Stray tokens land in the vault via a raw mint (simulating a direct transfer).
    mint_to(&mut svm, &authority, &mint, &mint_auth, &escrow, 777, &TOKEN_PROGRAM_ID);
    assert_eq!(token_balance(&svm, &escrow), 777);

    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    assert_eq!(read_invoice(&svm, &invoice).status, 2);

    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        recover_unattributed_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &merchant_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );

    assert_eq!(token_balance(&svm, &escrow), 0, "vault drained");
    assert_eq!(token_balance(&svm, &merchant_ata), 777);
    assert_eq!(read_invoice(&svm, &invoice).status, 2, "status unchanged by recover");
}
