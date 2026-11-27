mod common;

use common::*;

#[test]
fn a24_close_open_invoice() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 24, 1000, &mint);

    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(&merchant.pubkey(), &invoice, &mint, &escrow, &TOKEN_PROGRAM_ID),
    );
    assert_custom_error(res, &program_id(), 6017);
    assert!(account_exists(&svm, &invoice), "open invoice cannot close");
    assert!(account_exists(&svm, &escrow));
    assert_eq!(read_invoice(&svm, &invoice).status, 0);
}
