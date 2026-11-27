mod common;

use common::*;

#[test]
fn a19_recover_while_excess_outstanding() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 19, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);
    // Overpay.
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
            1600,
        ),
    );
    // Claim (caps at due); excess 600 stays outstanding in vault.
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
    assert_eq!(token_balance(&svm, &escrow), 600);
    assert_eq!(read_invoice(&svm, &invoice).refunded_excess, 0);

    // recover must fail ExcessOutstanding (6018) because excess is recorded but unrefunded.
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        recover_unattributed_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &merchant_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6018);
    assert_eq!(token_balance(&svm, &escrow), 600);
    assert_eq!(token_balance(&svm, &merchant_ata), 1000);
}
