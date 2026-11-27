mod common;

use common::*;

#[test]
fn h11_paid_flow_pay_claim_close() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 110, 1000, &mint);
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

    // Pay exact.
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

    // Claim.
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
    assert_eq!(
        token_balance(&svm, &escrow),
        0,
        "vault empty after exact pay+claim"
    );

    // Close: the escrow ATA is closed and the Invoice is kept as a closed tombstone.
    let escrow_rent = lamports(&svm, &escrow);
    let merchant_before = lamports(&svm, &merchant.pubkey());
    let fee = expect_ok_fee(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert!(!account_exists(&svm, &escrow), "escrow closed");
    assert!(account_exists(&svm, &invoice), "invoice tombstone kept");
    assert_eq!(
        invoice_account_len(&svm, &invoice),
        INVOICE_ACCOUNT_LEN,
        "tombstone keeps the full Invoice account length (219 bytes)"
    );
    let tombstone = read_invoice(&svm, &invoice);
    assert_eq!(tombstone.status, 3, "Closed tombstone status");
    assert_eq!(tombstone.claimed, true);
    let merchant_after = lamports(&svm, &merchant.pubkey());
    assert_eq!(
        merchant_after + fee,
        merchant_before + escrow_rent,
        "merchant recovers exactly the escrow rent on close"
    );
    assert_eq!(token_balance(&svm, &merchant_ata), 1000);
}
