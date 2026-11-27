mod common;

use common::*;

#[test]
fn a1_double_pay() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 1, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    let pay = |amount: u64| {
        pay_invoice_ix(
            &payer.pubkey(),
            &config,
            &invoice,
            &mint,
            &payer_ata,
            &escrow,
            &TOKEN_PROGRAM_ID,
            amount,
        )
    };

    expect_ok(&mut svm, &payer, &[&payer], pay(1000));
    let inv_after_first = read_invoice(&svm, &invoice);
    assert_eq!(inv_after_first.status, 1);
    let payer_bal = token_balance(&svm, &payer_ata);
    let escrow_bal = token_balance(&svm, &escrow);

    // Second pay fails DuplicatePayment (6001) and moves nothing.
    let res = send(&mut svm, &payer, &[&payer], pay(1000));
    assert_custom_error(res, &program_id(), 6001);

    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 1);
    assert_eq!(inv.paid_amount, 1000, "paid_amount unchanged");
    assert_eq!(inv.payer, payer.pubkey());
    assert_eq!(token_balance(&svm, &payer_ata), payer_bal, "payer balance unchanged");
    assert_eq!(token_balance(&svm, &escrow), escrow_bal, "escrow unchanged");
}
