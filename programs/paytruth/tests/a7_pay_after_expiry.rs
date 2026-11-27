mod common;

use common::*;

#[test]
fn a7_pay_after_expiry() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm,
        &merchant,
        &config,
        7,
        1000,
        expiry,
        [0u8; 64],
        &mint,
    );
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    // Boundary: at exactly expires_at pay is rejected (InvoiceExpired 6003).
    warp_to(&mut svm, expiry);
    let res = send(
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
        ),
    );
    assert_custom_error(res, &program_id(), 6003);

    // No transfer, no state change, invoice still Open (not auto-expired).
    assert_eq!(read_invoice(&svm, &invoice).status, 0);
    assert_eq!(read_invoice(&svm, &invoice).payer, Pubkey::default());
    assert_eq!(token_balance(&svm, &escrow), 0);
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
}

#[test]
fn a7b_pay_at_expires_at_minus_one_succeeds() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm,
        &merchant,
        &config,
        7,
        1000,
        expiry,
        [0u8; 64],
        &mint,
    );
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    warp_to(&mut svm, expiry - 1);
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
        ),
    );
    assert_eq!(read_invoice(&svm, &invoice).status, 1);
}
