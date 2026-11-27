mod common;

use common::*;

#[test]
fn a2_claim_twice() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 2, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(
        &mut svm,
        &payer,
        &mint,
        &mint_auth,
        &payer_ata,
        5_000,
        &TOKEN_PROGRAM_ID,
    );
    expect_ok(
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
            1000,
            1000,
        ),
    );

    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    let claim = merchant_claim_ix(
        &merchant.pubkey(),
        &invoice,
        &mint,
        &escrow,
        &merchant_ata,
        &TOKEN_PROGRAM_ID,
    );
    expect_ok(&mut svm, &merchant, &[&merchant], claim);
    let mid_merchant = token_balance(&svm, &merchant_ata);
    let mid_escrow = token_balance(&svm, &escrow);

    let claim2 = merchant_claim_ix(
        &merchant.pubkey(),
        &invoice,
        &mint,
        &escrow,
        &merchant_ata,
        &TOKEN_PROGRAM_ID,
    );
    let res = send(&mut svm, &merchant, &[&merchant], claim2);
    assert_custom_error(res, &program_id(), 6005);
    assert_eq!(
        token_balance(&svm, &merchant_ata),
        mid_merchant,
        "merchant balance unchanged"
    );
    assert_eq!(token_balance(&svm, &escrow), mid_escrow, "escrow unchanged");
}
