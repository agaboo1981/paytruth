mod common;

use common::*;

#[test]
fn a23_recover_empty_vault() {
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
        23,
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

    // Terminal but vault is empty -> NothingToRecover (6019).
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    let res = send(
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
    assert_custom_error(res, &program_id(), 6019);
    assert_eq!(read_invoice(&svm, &invoice).status, 2);
    assert_eq!(token_balance(&svm, &merchant_ata), 0);
}
