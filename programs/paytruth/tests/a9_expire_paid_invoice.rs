mod common;

use common::*;

#[test]
fn a9_expire_paid_invoice() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm, &merchant, &config, 9, 1000, expiry, [0u8; 64], &mint,
    );
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
    assert_eq!(read_invoice(&svm, &invoice).status, 1);

    // Past expiry the Paid invoice still must not expire (InvoiceNotOpen 6002).
    warp_to(&mut svm, expiry + 5_000);
    let res = send(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    assert_custom_error(res, &program_id(), 6002);
    assert_eq!(
        read_invoice(&svm, &invoice).status,
        1,
        "Paid invoices cannot expire"
    );
}
