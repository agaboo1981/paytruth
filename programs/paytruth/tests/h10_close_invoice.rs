mod common;

use common::*;

#[test]
fn h10_close_invoice_empty_vault() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm, &merchant, &config, 100, 1000, expiry, [0u8; 64], &mint,
    );

    // Expire first so the invoice reaches a terminal state with an empty vault.
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );

    let invoice_rent = lamports(&svm, &invoice);
    let escrow_rent = lamports(&svm, &escrow);
    assert!(invoice_rent > 0 && escrow_rent > 0);
    let invoice_owner = svm.get_account(&invoice).unwrap().owner;
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

    // Only the escrow ATA is closed; the Invoice account is kept as a tombstone.
    assert!(!account_exists(&svm, &escrow), "escrow account closed");
    assert!(account_exists(&svm, &invoice), "invoice tombstone kept");
    assert_eq!(
        invoice_account_len(&svm, &invoice),
        INVOICE_ACCOUNT_LEN,
        "tombstone keeps the full Invoice account length (219 bytes)"
    );
    assert_eq!(
        svm.get_account(&invoice).unwrap().owner,
        invoice_owner,
        "tombstone still owned by the program"
    );
    let tombstone = read_invoice(&svm, &invoice);
    assert_eq!(tombstone.status, 3, "Closed tombstone status");
    assert_eq!(tombstone.amount_due, 1000, "tombstone retains terms");
    assert_eq!(tombstone.invoice_id, 100);

    // Merchant receives ONLY the escrow rent, less the exact tx fee. The Invoice rent stays
    // locked in the kept tombstone account.
    let merchant_after = lamports(&svm, &merchant.pubkey());
    assert_eq!(
        merchant_after + fee,
        merchant_before + escrow_rent,
        "merchant must recover exactly the escrow rent: before {merchant_before} after {merchant_after} escrow_rent {escrow_rent} fee {fee}"
    );
}
