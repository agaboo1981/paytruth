mod common;

use common::*;

#[test]
fn a6_refund_twice() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 6, 1000, &mint);
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

    let refund = || {
        refund_overpayment_ix(
            &payer.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &payer.pubkey(),
            &payer_ata,
            &TOKEN_PROGRAM_ID,
        )
    };

    expect_ok(&mut svm, &payer, &[&payer], refund());
    assert_eq!(read_invoice(&svm, &invoice).refunded_excess, 500);
    let payer_bal = token_balance(&svm, &payer_ata);
    let escrow_bal = token_balance(&svm, &escrow);

    let res = send(&mut svm, &payer, &[&payer], refund());
    assert_custom_error(res, &program_id(), 6006);
    assert_eq!(read_invoice(&svm, &invoice).refunded_excess, 500);
    assert_eq!(
        token_balance(&svm, &payer_ata),
        payer_bal,
        "no second refund"
    );
    assert_eq!(token_balance(&svm, &escrow), escrow_bal);
}
