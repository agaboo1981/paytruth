mod common;

use common::*;

#[test]
fn a21_direct_transfer_then_recover() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm,
        &merchant,
        &config,
        21,
        1000,
        expiry,
        [0u8; 64],
        &mint,
    );
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    // Direct SPL transfer into the escrow — NOT pay_invoice.
    raw_transfer(
        &mut svm,
        &payer,
        &payer,
        &payer_ata,
        &escrow,
        700,
        &TOKEN_PROGRAM_ID,
    );

    // Status must be unchanged (still Open), no payer recorded.
    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 0, "direct transfer does not mark Paid");
    assert_eq!(inv.payer, Pubkey::default());
    assert_eq!(inv.paid_amount, 0);
    assert_eq!(token_balance(&svm, &escrow), 700);

    // After expiry the merchant recovers the stray funds.
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    expect_ok(
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
    assert_eq!(token_balance(&svm, &escrow), 0);
    assert_eq!(token_balance(&svm, &merchant_ata), 700);
    assert_eq!(read_invoice(&svm, &invoice).status, 2, "recover does not change status");
}
