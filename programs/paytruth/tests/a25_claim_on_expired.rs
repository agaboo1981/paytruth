mod common;

use common::*;

#[test]
fn a25_claim_on_expired() {
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
        25,
        1000,
        expiry,
        [0u8; 64],
        &mint,
    );
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    assert_eq!(read_invoice(&svm, &invoice).status, 2);

    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        merchant_claim_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &merchant_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6004);
    assert!(!read_invoice(&svm, &invoice).claimed);
    assert_eq!(token_balance(&svm, &merchant_ata), 0);
}
