mod common;

use common::*;

#[test]
fn h3_pay_exact() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 1, 1000, &mint);
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

    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 1);
    assert_eq!(inv.paid_amount, 1000);
    assert_eq!(inv.amount_due, 1000);
    assert_eq!(inv.payer, payer.pubkey());
    assert_eq!(inv.paid_amount - inv.amount_due, 0, "excess must be 0");
    assert_eq!(token_balance(&svm, &escrow), 1000);
    assert_eq!(
        token_balance(&svm, &payer_ata),
        4_000,
        "payer debited exactly"
    );
}
