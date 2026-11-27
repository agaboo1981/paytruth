mod common;

use common::*;

/// QA M2: `pay_invoice` binds the signed tx to the invoice terms via `expected_amount_due`.
/// A mismatch of +1 or -1 must fail InvoiceMismatch (6022) before any transfer, then the
/// correct value succeeds.
#[test]
fn m2_pay_expected_amount_due_mismatch() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 200, 1000, &mint);
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

    let pay = |expected: u64| {
        pay_invoice_ix(
            &payer.pubkey(),
            &config,
            &invoice,
            &mint,
            &payer_ata,
            &escrow,
            &TOKEN_PROGRAM_ID,
            1000,
            expected,
        )
    };

    // expected = amount_due + 1.
    let res = send(&mut svm, &payer, &[&payer], pay(1001));
    assert_custom_error(res, &program_id(), 6022);
    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 0, "still Open");
    assert_eq!(inv.paid_amount, 0, "no payment recorded");
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
    assert_eq!(token_balance(&svm, &escrow), 0);

    // expected = amount_due - 1.
    let res = send(&mut svm, &payer, &[&payer], pay(999));
    assert_custom_error(res, &program_id(), 6022);
    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 0, "still Open");
    assert_eq!(inv.paid_amount, 0, "no payment recorded");
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
    assert_eq!(token_balance(&svm, &escrow), 0);

    // The correct expected value succeeds.
    expect_ok(&mut svm, &payer, &[&payer], pay(1000));
    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 1, "Paid");
    assert_eq!(inv.paid_amount, 1000);
    assert_eq!(token_balance(&svm, &payer_ata), 4_000);
    assert_eq!(token_balance(&svm, &escrow), 1000);
}
