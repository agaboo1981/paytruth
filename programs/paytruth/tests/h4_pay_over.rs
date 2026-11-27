mod common;

use common::*;

#[test]
fn h4_pay_over() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 4, 1000, &mint);
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
            1500,
            1000,
        ),
    );

    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 1);
    assert_eq!(inv.paid_amount, 1500);
    assert!(inv.paid_amount > inv.amount_due);
    assert_eq!(
        inv.paid_amount - inv.amount_due,
        500,
        "excess == paid - due"
    );
    assert_eq!(inv.refunded_excess, 0);
    assert_eq!(token_balance(&svm, &escrow), 1500, "full amount escrowed");
    assert_eq!(token_balance(&svm, &payer_ata), 3_500);
}
