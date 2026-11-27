mod common;

use common::*;

#[test]
fn h6_refund_overpayment() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 6, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);
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
        ),
    );

    // Caller is a third party (any fee payer) refunding to the recorded payer ATA.
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        refund_overpayment_ix(
            &caller.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &payer.pubkey(),
            &payer_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );

    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.refunded_excess, 500);
    assert_eq!(token_balance(&svm, &payer_ata), 4_000, "payer got excess back");
    assert_eq!(token_balance(&svm, &escrow), 1000, "vault now holds exactly amount_due");
}
