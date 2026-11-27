mod common;

use common::*;

#[test]
fn a17_create_expiry_in_past() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);

    let invoice_id = 17;
    let (invoice, _bump) = invoice_pda(&merchant.pubkey(), invoice_id);
    let escrow = escrow_ata(&invoice, &mint);
    let past = now(&svm) - 1;

    let ix = create_invoice_ix(
        &merchant.pubkey(),
        &config,
        &invoice,
        &mint,
        &escrow,
        &TOKEN_PROGRAM_ID,
        &CreateInvoiceArgs {
            invoice_id,
            amount_due: 1000,
            expires_at: past,
            memo: [0u8; 64],
        },
    );
    let res = send(&mut svm, &merchant, &[&merchant], ix);
    assert_custom_error(res, &program_id(), 6010);
    assert!(!account_exists(&svm, &invoice));
    assert!(!account_exists(&svm, &escrow));
}

#[test]
fn a17b_create_expiry_equal_now_is_rejected() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);

    let invoice_id = 17;
    let (invoice, _bump) = invoice_pda(&merchant.pubkey(), invoice_id);
    let escrow = escrow_ata(&invoice, &mint);
    // expires_at must be strictly > now; == now is rejected.
    let expires = now(&svm);

    let ix = create_invoice_ix(
        &merchant.pubkey(),
        &config,
        &invoice,
        &mint,
        &escrow,
        &TOKEN_PROGRAM_ID,
        &CreateInvoiceArgs {
            invoice_id,
            amount_due: 1000,
            expires_at: expires,
            memo: [0u8; 64],
        },
    );
    let res = send(&mut svm, &merchant, &[&merchant], ix);
    assert_custom_error(res, &program_id(), 6010);
    assert!(!account_exists(&svm, &invoice));
}
