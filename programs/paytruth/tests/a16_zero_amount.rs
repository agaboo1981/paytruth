mod common;

use common::*;

#[test]
fn a16a_create_zero_amount() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);

    let invoice_id = 16;
    let (invoice, expected_bump) = invoice_pda(&merchant.pubkey(), invoice_id);
    let escrow = escrow_ata(&invoice, &mint);
    let expiry = now(&svm) + 1_000;

    let ix = create_invoice_ix(
        &merchant.pubkey(),
        &config,
        &invoice,
        &mint,
        &escrow,
        &TOKEN_PROGRAM_ID,
        &CreateInvoiceArgs {
            invoice_id,
            amount_due: 0,
            expires_at: expiry,
            memo: [0u8; 64],
        },
    );
    let res = send(&mut svm, &merchant, &[&merchant], ix);
    assert_custom_error(res, &program_id(), 6009);
    let _ = expected_bump;

    assert!(!account_exists(&svm, &invoice), "invoice not created");
    assert!(!account_exists(&svm, &escrow), "escrow not created");
}

#[test]
fn a16b_pay_zero_amount() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 16, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

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
            0,
        ),
    );
    assert_custom_error(res, &program_id(), 6009);
    assert_eq!(read_invoice(&svm, &invoice).status, 0);
    assert_eq!(token_balance(&svm, &escrow), 0);
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
}
