mod common;

use common::*;

fn paid_over(
    svm: &mut LiteSVM,
    config: &Pubkey,
    mint: &Pubkey,
    mint_auth: &Keypair,
    invoice: &Pubkey,
    escrow: &Pubkey,
    payer: &Keypair,
    payer_ata: &Pubkey,
) {
    mint_to(
        svm,
        payer,
        mint,
        mint_auth,
        payer_ata,
        5_000,
        &TOKEN_PROGRAM_ID,
    );
    expect_ok(
        svm,
        payer,
        &[payer],
        pay_invoice_ix(
            &payer.pubkey(),
            config,
            invoice,
            mint,
            payer_ata,
            escrow,
            &TOKEN_PROGRAM_ID,
            1500,
            1000,
        ),
    );
}

#[test]
fn h7_refund_before_claim() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 70, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    paid_over(
        &mut svm, &config, &mint, &mint_auth, &invoice, &escrow, &payer, &payer_ata,
    );

    // Refund BEFORE claim succeeds.
    expect_ok(
        &mut svm,
        &payer,
        &[&payer],
        refund_overpayment_ix(
            &payer.pubkey(),
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
    assert!(!inv.claimed);
    assert_eq!(token_balance(&svm, &escrow), 1000);
}

#[test]
fn h7_refund_after_claim() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 71, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    paid_over(
        &mut svm, &config, &mint, &mint_auth, &invoice, &escrow, &payer, &payer_ata,
    );

    // Claim first.
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
    assert!(read_invoice(&svm, &invoice).claimed);

    // Refund AFTER claim succeeds.
    expect_ok(
        &mut svm,
        &payer,
        &[&payer],
        refund_overpayment_ix(
            &payer.pubkey(),
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
    assert!(inv.claimed);
    assert_eq!(token_balance(&svm, &merchant_ata), 1000);
    assert_eq!(
        token_balance(&svm, &escrow),
        0,
        "vault empty after claim+refund"
    );
}
