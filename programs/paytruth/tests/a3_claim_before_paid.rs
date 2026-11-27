mod common;

use common::*;

#[test]
fn a3_claim_before_paid() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 3, 1000, &mint);
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
    assert_eq!(read_invoice(&svm, &invoice).status, 0, "still open");
    assert!(!read_invoice(&svm, &invoice).claimed);
    assert_eq!(token_balance(&svm, &merchant_ata), 0);
}
