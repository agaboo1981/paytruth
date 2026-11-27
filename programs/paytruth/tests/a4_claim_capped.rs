mod common;

use common::*;

#[test]
fn a4_claim_capped_at_amount_due() {
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

    // Overpay to 1800 (excess 800).
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
            1800,
            1000,
        ),
    );
    assert_eq!(token_balance(&svm, &escrow), 1800);

    // There is no amount arg on merchant_claim; the transfer is hard-capped at amount_due.
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        merchant_claim_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &merchant_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );

    assert_eq!(
        token_balance(&svm, &merchant_ata),
        1000,
        "merchant receives exactly amount_due, never the excess"
    );
    assert_eq!(token_balance(&svm, &escrow), 800, "excess stays in vault");
    let inv = read_invoice(&svm, &invoice);
    assert!(inv.claimed);
    assert_eq!(inv.paid_amount - inv.amount_due, 800);
}
