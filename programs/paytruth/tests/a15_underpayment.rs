mod common;

use common::*;

#[test]
fn a15_underpayment() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 15, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    let res = send(
        &mut svm,
        &payer,
        &[&payer],
        pay_invoice_ix(
            &payer.pubkey(),
            &config,
            &invoice,
            &mint,
            &payer_ata,
            &escrow,
            &TOKEN_PROGRAM_ID,
            999,
        ),
    );
    assert_custom_error(res, &program_id(), 6000);

    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 0, "still Open");
    assert_eq!(inv.paid_amount, 0);
    assert_eq!(inv.payer, Pubkey::default());
    assert_eq!(token_balance(&svm, &escrow), 0, "no transfer");
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
}
