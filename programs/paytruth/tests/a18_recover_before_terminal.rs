mod common;

use common::*;

#[test]
fn a18_recover_before_terminal() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 18, 1000, &mint);
    // Some stray funds so the vault is non-empty (so the failure is terminal, not NothingToRecover).
    mint_to(&mut svm, &authority, &mint, &mint_auth, &escrow, 500, &TOKEN_PROGRAM_ID);

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
    assert_custom_error(res, &program_id(), 6017);
    assert_eq!(read_invoice(&svm, &invoice).status, 0, "status unchanged");
    assert_eq!(token_balance(&svm, &escrow), 500);
}
